# ADR-0007: Matrix expansion semantics for include and exclude

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-033, RY-038 (matrix-aware needs, planned)

## Context

A job may declare a matrix of axes (`os: [linux, mac]`, `node: [18, 20, 22]`) plus `exclude` and `include` lists. Users bring expectations from other CI systems, where include semantics are subtle: an include entry can either add extra keys to existing combinations or add a brand-new combination. The semantics must be precise, deterministic, documented and bounded, because the planner, the validator and the run graph all depend on the exact instance set and on stable instance keys.

## Decision Drivers

- Deterministic order and stable keys (`test[node=20,os=linux]`) for idempotent planning and readable UI.
- Familiar behaviour for users of mainstream CI matrices.
- Partial matching so a single-key exclude removes every matching combination.
- Hard upper bounds: 8 axes, 64 values per axis, 256 combinations per job, 1000 planned jobs per run.

## Considered Options

1. Cartesian product only; no include/exclude.
2. Exclude only, applied after the product.
3. Product, then exclude by partial match, then include entries applied in order: merge into every product combination whose original axis values the entry does not overwrite, otherwise append as a new combination.
4. Include applied before exclude.

## Decision Outcome

Chosen option: **3**. `expandMatrix` in `packages/shared/src/pipeline/matrix.ts`:

1. Cartesian product in declaration order; the first axis varies slowest.
2. Remove every combination that matches any `exclude` entry; matching is partial (all keys of the entry equal, compared as strings so `20` matches `'20'`).
3. For each `include` entry, in order: take only the entry's keys that are axis names; merge the full entry into every **product-derived** combination whose **original** axis values match those keys. If it matched none, append it as a new combination. Appended combinations never absorb later includes. Because matching uses the original product values, a later include may overwrite a non-axis key added by an earlier include, but never an axis value.

Further rules:

- Exclude runs before include, so an include can re-add a combination that exclude removed (as a new appended combination).
- An include-only matrix (no axes) is valid and yields exactly its entries.
- A matrix that expands to zero combinations is a validation error (`empty_matrix`), more than 256 is `matrix_too_large`.
- `if:` is evaluated per instance during planning, so a condition may reference `matrix.*`.
- Each instance gets environment variables `MATRIX_<AXIS>` (upper-cased, `-` to `_`).
- `needs: [test]` depends on all instances of `test`. Depending on specific instances is RY-038.

### Consequences

- Positive: behaviour matches the most common user expectation and is fully specified by tests in `packages/shared/test/matrix.test.ts` (partial excludes, merge without overwriting axes, append, later-include overwrite, include-only, string coercion).
- Positive: instance keys are stable across runs for the same inputs, enabling history comparisons (RY-113 flaky detection).
- Negative: include semantics are subtle; the user guide (RY-148) must show worked examples.
- Negative: the size check currently counts by expanding; it must short-circuit on the arithmetic product before expansion (quality-attributes section 4).
- Rejected: options 1-2 are too limited for real-world matrices (adding one extra platform-specific combination is common); option 4 makes it impossible to add back a combination after excluding a family.
