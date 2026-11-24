import { isTerminal, type JobStatus } from '@railyard/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../../http/context.js';
import type { HubEvent } from './log-hub.js';
import { listChunks } from './log.repository.js';

const HEARTBEAT_MS = 15_000;
const BATCH = 500;

interface StreamOptions {
  readonly ctx: AppContext;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly jobId: string;
  readonly initialStatus: JobStatus;
  readonly afterSeq: number;
}

/**
 * Server-Sent Events stream for one job:
 *   event: log    id: <seq>  data: {seq, stream, content}
 *   event: status            data: {status}
 *   event: end               data: {}
 * Subscribes before back-filling so no chunk written in between is missed; all fetches run
 * through one promise chain so chunks are emitted exactly once and in order.
 */
export async function streamJobLogs(opts: StreamOptions): Promise<void> {
  const { ctx, request, reply, jobId } = opts;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  });
  let lastSeq = opts.afterSeq;
  let finished = false;
  let chain: Promise<void> = Promise.resolve();
  const write = (text: string): void => {
    if (!finished) raw.write(text);
  };

  const drain = async (): Promise<void> => {
    for (;;) {
      const chunks = await listChunks(ctx.pool, jobId, lastSeq, BATCH);
      for (const chunk of chunks) {
        write(
          `event: log\nid: ${chunk.seq}\ndata: ${JSON.stringify({ seq: chunk.seq, stream: chunk.stream, content: chunk.content })}\n\n`,
        );
        lastSeq = chunk.seq;
      }
      if (chunks.length < BATCH) return;
    }
  };

  const end = (): void => {
    if (finished) return;
    write('event: end\ndata: {}\n\n');
    finished = true;
    cleanup();
    raw.end();
  };

  const onEvent = (event: HubEvent): void => {
    chain = chain
      .then(async () => {
        await drain();
        if (event.type === 'status') {
          write(`event: status\ndata: ${JSON.stringify({ status: event.status })}\n\n`);
          if (isTerminal(event.status as JobStatus)) end();
        }
      })
      .catch((err: unknown) => {
        ctx.logger.error({ err, jobId }, 'log stream failed');
        end();
      });
  };

  const unsubscribe = await ctx.logHub.subscribe(jobId, onEvent);
  const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  raw.on('close', () => {
    finished = true;
    cleanup();
  });

  write('retry: 2000\n\n');
  // The status event doubles as the initial back-fill trigger; terminal jobs end right after it.
  onEvent({ type: 'status', status: opts.initialStatus });
  await chain;
}
