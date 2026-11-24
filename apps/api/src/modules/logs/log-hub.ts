import pg from 'pg';
import type { Logger } from 'pino';
import { JOB_CHANNEL, LOG_CHANNEL } from '../runs/notify.js';

export type HubEvent =
  | { readonly type: 'log'; readonly seq: number }
  | { readonly type: 'status'; readonly status: string };
export type HubListener = (event: HubEvent) => void;

export interface LogHub {
  subscribe(jobId: string, listener: HubListener): Promise<() => void>;
  close(): Promise<void>;
}

const RECONNECT_DELAY_MS = 1000;

/**
 * Multiplexes Postgres LISTEN/NOTIFY onto in-process subscribers keyed by job id. One dedicated
 * connection per API process regardless of how many SSE clients are attached. The connection is
 * opened lazily and re-established after errors while subscribers remain.
 */
export function createLogHub(connectionString: string, logger: Logger): LogHub {
  const listeners = new Map<string, Set<HubListener>>();
  let client: pg.Client | null = null;
  let connecting: Promise<void> | null = null;
  let closed = false;

  const dispatch = (jobId: string, event: HubEvent): void => {
    for (const listener of listeners.get(jobId) ?? []) listener(event);
  };

  const onNotification = (msg: pg.Notification): void => {
    try {
      const payload = JSON.parse(msg.payload ?? '{}') as {
        jobId?: string;
        seq?: number;
        status?: string;
      };
      if (!payload.jobId) return;
      if (msg.channel === LOG_CHANNEL && typeof payload.seq === 'number') {
        dispatch(payload.jobId, { type: 'log', seq: payload.seq });
      } else if (msg.channel === JOB_CHANNEL && payload.status) {
        dispatch(payload.jobId, { type: 'status', status: payload.status });
      }
    } catch (err) {
      logger.warn({ err }, 'ignoring malformed notification');
    }
  };

  const connect = async (): Promise<void> => {
    const next = new pg.Client({ connectionString, application_name: 'railyard-log-hub' });
    next.on('notification', onNotification);
    next.on('error', (err) => {
      logger.error({ err }, 'log hub connection error');
      client = null;
      void next.end().catch(() => undefined);
      if (!closed && listeners.size > 0)
        setTimeout(() => void ensureConnected().catch(() => undefined), RECONNECT_DELAY_MS);
    });
    await next.connect();
    await next.query(`LISTEN ${LOG_CHANNEL}`);
    await next.query(`LISTEN ${JOB_CHANNEL}`);
    client = next;
  };

  const ensureConnected = async (): Promise<void> => {
    if (client || closed) return;
    connecting ??= connect().finally(() => {
      connecting = null;
    });
    await connecting;
  };

  return {
    async subscribe(jobId, listener) {
      await ensureConnected();
      const set = listeners.get(jobId) ?? new Set<HubListener>();
      set.add(listener);
      listeners.set(jobId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(jobId);
      };
    },
    async close() {
      closed = true;
      listeners.clear();
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
  };
}
