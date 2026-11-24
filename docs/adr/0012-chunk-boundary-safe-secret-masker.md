# ADR-0012: Streaming secret masker that is safe across chunk boundaries

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-063; RY-072 (secret injection, supplies the secret values)

## Context

Secrets injected into jobs (RY-072) must never appear in stored or streamed logs. Process output arrives in arbitrary chunks determined by pipe buffering: a secret `hunter2-token` can arrive as `...hunt` in one chunk and `er2-token...` in the next. Masking each chunk independently leaks such secrets. Logs are persisted every 250 ms, so the masker cannot wait for the end of the stream.

## Decision Drivers

- Masking result must be identical for every possible chunking of the same stream.
- Minimal added latency; only text that could still turn out to be a secret may be delayed.
- Overlapping secrets: the longest match wins.
- Avoid masking trivially short values that would destroy readability.

## Considered Options

1. Mask each chunk independently with string replacement.
2. Mask line by line, buffering until newline.
3. Hold back the longest suffix of the masked text that is a prefix of some secret (at most `maxSecretLength - 1` characters), release it with the next chunk or on flush.
4. Aho-Corasick automaton over the byte stream.

## Decision Outcome

Chosen option: **3**, `createMasker` in `packages/shared/src/logs/mask.ts`.

- Secrets shorter than 4 characters (`MIN_SECRET_LENGTH`) are ignored; duplicates removed; remaining values sorted by length descending so longer secrets are replaced first.
- `push(chunk)`: concatenate the pending tail with the chunk, replace every secret occurrence with `***`, compute the longest suffix (up to `maxLen - 1`) that is a prefix of any secret, return everything before it and keep it pending.
- `flush()`: mask and return the pending tail; called by `LogWriter.close()`.
- One masker per stream (`stdout`, `stderr`, `system`) because streams interleave independently.

### Consequences

- Positive: property test "masks every chunking of a stream identically" in `packages/shared/test/logs.test.ts` proves chunking-independence for random splits.
- Positive: latency impact is limited to at most `maxLen - 1` characters and only when the tail actually resembles a secret prefix; ordinary output passes straight through.
- Negative: cost per chunk is O(k·n) for replacement plus O(L²·k) for the suffix search (k secrets, n chunk length, L longest secret). With tens of secrets of under 100 characters this is negligible; option 4 is the upgrade path if organizations register hundreds of secrets.
- Negative: transformed secrets (base64, URL-encoded, split by the program itself) are not detected. This is documented in the threat model; RY-072 will additionally register common encodings of each secret.
- Negative: until RY-072 lands, runners construct the writer without secrets, so the masker is wired but inactive in production.
- Rejected: option 1 leaks split secrets; option 2 delays output until newline (progress bars and prompts never appear) and still fails on secrets containing newlines.
