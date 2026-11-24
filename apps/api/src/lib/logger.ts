import pino, { type Logger } from 'pino';

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
];

export function createLogger(level: string, name = 'railyard'): Logger {
  return pino({ name, level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } });
}
