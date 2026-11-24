import { useEffect, useState } from 'react';
import type { LogLine } from '../components/AnsiLog';
import { splitChunks } from '../components/AnsiLog';

interface Chunk {
  readonly seq: number;
  readonly stream: LogLine['stream'];
  readonly content: string;
}

/**
 * Subscribes to a job's SSE log stream. EventSource reconnects automatically and sends
 * Last-Event-ID, so the server resumes after the last chunk we saw.
 */
export function useJobLog(runId: string | undefined, jobId: string | null) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setChunks([]);
    setStatus(null);
    if (!runId || !jobId) return undefined;
    const source = new EventSource(`/api/runs/${runId}/jobs/${jobId}/logs/stream`);
    source.addEventListener('log', (event) => {
      const chunk = JSON.parse((event as MessageEvent<string>).data) as Chunk;
      setChunks((prev) => (prev.some((c) => c.seq === chunk.seq) ? prev : [...prev, chunk]));
    });
    source.addEventListener('status', (event) => {
      setStatus((JSON.parse((event as MessageEvent<string>).data) as { status: string }).status);
    });
    source.addEventListener('end', () => source.close());
    return () => source.close();
  }, [runId, jobId]);

  return { lines: splitChunks(chunks), status };
}
