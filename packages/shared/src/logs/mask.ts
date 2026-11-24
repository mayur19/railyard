/**
 * Streaming secret masker. Log output arrives in arbitrary chunks, so a secret may be split
 * across two chunks; the masker therefore holds back up to (longest secret - 1) characters of
 * each chunk until the next chunk (or flush) proves they cannot start a secret.
 */
export const MASK = '***';
export const MIN_SECRET_LENGTH = 4;

export interface Masker {
  /** Masks a chunk; may return less text than given (the remainder is buffered). */
  push(chunk: string): string;
  /** Returns any buffered text, masked. Call at end of stream. */
  flush(): string;
}

export function createMasker(secrets: readonly string[]): Masker {
  const values = [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  );
  const holdBack = values.length > 0 ? (values[0] as string).length - 1 : 0;
  let pending = '';

  const maskAll = (text: string): string =>
    values.reduce((acc, secret) => acc.split(secret).join(MASK), text);

  return {
    push(chunk: string): string {
      if (values.length === 0) return chunk;
      const text = pending + chunk;
      const masked = maskAll(text);
      // Only the tail that could be a secret prefix needs to be held back.
      const keep = longestSecretPrefixSuffix(masked, values, holdBack);
      pending = masked.slice(masked.length - keep);
      return masked.slice(0, masked.length - keep);
    },
    flush(): string {
      const out = maskAll(pending);
      pending = '';
      return out;
    },
  };
}

function longestSecretPrefixSuffix(text: string, secrets: readonly string[], max: number): number {
  for (let len = Math.min(max, text.length); len > 0; len -= 1) {
    const tail = text.slice(text.length - len);
    if (secrets.some((secret) => secret.startsWith(tail))) return len;
  }
  return 0;
}

/** One-shot masking for complete strings. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  const masker = createMasker(secrets);
  return masker.push(text) + masker.flush();
}
