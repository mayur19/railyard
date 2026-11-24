import { createMasker, type Masker } from '@railyard/shared';
import type { Pool } from '../db/pool.js';
import { insertChunks, type LogStream } from '../modules/logs/log.repository.js';
import { notifyLog } from '../modules/runs/notify.js';

export interface LogWriterOptions {
  readonly pool: Pool;
  readonly jobId: string;
  readonly attempt: number;
  readonly firstSeq: number;
  readonly secrets?: readonly string[];
  readonly flushIntervalMs?: number;
  readonly maxBufferedBytes?: number;
  readonly maxTotalBytes?: number;
  /** Called when persisting a batch fails; the batch is kept and retried on the next flush. */
  readonly onError?: (err: unknown) => void;
}

interface Pending {
  readonly stream: LogStream;
  readonly content: string;
}

/**
 * Buffers job output and persists it in sequenced chunks, coalescing consecutive writes to the
 * same stream. Flushes on a timer, when the buffer grows large, and on close; each flush is one
 * INSERT plus one NOTIFY so live viewers can fetch the new range. Output beyond maxTotalBytes is
 * dropped with a single system notice (protects the database from runaway logs).
 */
export class LogWriter {
  private buffer: Pending[] = [];
  private bufferedBytes = 0;
  private totalBytes = 0;
  private truncated = false;
  private nextSeq: number;
  private flushing: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;
  private readonly maskers = new Map<LogStream, Masker>();

  constructor(private readonly opts: LogWriterOptions) {
    this.nextSeq = opts.firstSeq;
    this.timer = setInterval(() => void this.flush(), opts.flushIntervalMs ?? 250);
    for (const stream of ['stdout', 'stderr', 'system'] as const)
      this.maskers.set(stream, createMasker(opts.secrets ?? []));
  }

  write(stream: LogStream, text: string): void {
    const masked = (this.maskers.get(stream) as Masker).push(text);
    this.append(stream, masked);
  }

  system(text: string): void {
    this.append('system', text.endsWith('\n') ? text : `${text}\n`);
  }

  private append(stream: LogStream, content: string): void {
    if (content === '') return;
    const limit = this.opts.maxTotalBytes ?? 5 * 1024 * 1024;
    if (this.truncated) return;
    if (this.totalBytes + content.length > limit) {
      this.truncated = true;
      this.push('system', `[railyard] log truncated after ${limit} bytes\n`);
      return;
    }
    this.totalBytes += content.length;
    this.push(stream, content);
    if (this.bufferedBytes >= (this.opts.maxBufferedBytes ?? 64 * 1024)) void this.flush();
  }

  private push(stream: LogStream, content: string): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && last.stream === stream)
      this.buffer[this.buffer.length - 1] = { stream, content: last.content + content };
    else this.buffer.push({ stream, content });
    this.bufferedBytes += content.length;
  }

  /** Never rejects: timer-driven flushes must not surface as unhandled rejections. */
  flush(): Promise<void> {
    this.flushing = this.flushing
      .then(() => this.persist())
      .catch((err: unknown) => this.opts.onError?.(err));
    return this.flushing;
  }

  private async persist(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.bufferedBytes = 0;
    const firstSeq = this.nextSeq;
    const chunks = batch.map((item, index) => ({
      seq: firstSeq + index,
      attempt: this.opts.attempt,
      ...item,
    }));
    try {
      await insertChunks(this.opts.pool, this.opts.jobId, chunks);
    } catch (err) {
      // Put the batch back in front of anything written meanwhile; sequence numbers are reused.
      this.buffer = [...batch, ...this.buffer];
      this.bufferedBytes += batch.reduce((n, item) => n + item.content.length, 0);
      throw err;
    }
    this.nextSeq = firstSeq + chunks.length;
    await notifyLog(this.opts.pool, {
      jobId: this.opts.jobId,
      seq: (chunks[chunks.length - 1] as { seq: number }).seq,
    });
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    for (const [stream, masker] of this.maskers) this.push(stream, masker.flush());
    this.buffer = this.buffer.filter((item) => item.content !== '');
    await this.flush();
  }
}
