import type { ApiEnvelope, ApiError } from '@railyard/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
    this.name = 'ApiRequestError';
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export interface ApiResult<T> {
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

/** Fetch wrapper: JSON envelope, cookie credentials, CSRF header on mutating requests. */
export async function api<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('ry_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return { data: undefined as T };
  const envelope = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !envelope || envelope.error) {
    throw new ApiRequestError(
      res.status,
      envelope?.error ?? { code: 'NETWORK', message: `Request failed (${res.status})` },
    );
  }
  return { data: envelope.data as T, ...(envelope.meta ? { meta: envelope.meta } : {}) };
}
