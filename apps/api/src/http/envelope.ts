import type { ApiEnvelope, ApiError } from '@railyard/shared';

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiEnvelope<T> {
  return meta ? { data, error: null, meta } : { data, error: null };
}

export function fail(error: ApiError): ApiEnvelope<null> {
  return { data: null, error };
}
