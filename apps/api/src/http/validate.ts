import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './errors.js';

/** Parses untrusted input with a zod schema, throwing a 400 envelope-friendly error. */
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', details);
  }
  return result.data;
}
