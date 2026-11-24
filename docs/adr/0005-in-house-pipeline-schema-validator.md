# ADR-0005: In-house pipeline schema validator with path-addressed issues and line numbers

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-030, RY-031, RY-036, RY-039 (JSON Schema export, planned)

## Context

The pipeline file is the product's primary user interface. Users need every problem reported at once, each pinned to a YAML path (`jobs.test.steps[2].run`) and a line/column so the editor can underline it. Many rules are not expressible in a structural schema: cycle detection across `needs`, "a job may not need a job in a later stage", references inside `${{ }}` that must name a declared matrix axis or env variable, matrix combination counts after include/exclude, cron syntax, and warnings for keys that are accepted but not executed yet (`cache`, `artifacts`, `environment`, `concurrency`).

## Decision Drivers

- Every issue carries `severity`, a stable machine `code`, a dotted path and a source position.
- Report all independent errors in one pass; never stop at the first.
- Semantic rules (graph, expressions, matrix size, cron) share one issue model with structural rules.
- Must run identically in the browser and in Node, with no code generation step.
- Error messages are part of the UX and must be domain-worded ("needs unknown job 'lint'"), not schema-worded ("must match anyOf").

## Considered Options

1. JSON Schema (draft 2020-12) validated with ajv, plus a second pass of custom semantic checks.
2. zod schemas for the pipeline, plus custom checks.
3. Hand-written reader functions (`readJob`, `readMatrix`, `readSteps`, ...) feeding an `IssueCollector`, followed by a `checkSemantics` pass; the `yaml` library only parses and supplies positions.

## Decision Outcome

Chosen option: **3, in-house validator**.

- `loadYaml` parses with `yaml`'s `parseDocument` (`uniqueKeys: true`, `maxAliasCount: 50`, 256 KiB cap) and returns a locator that walks up a path until it finds a node with a source range, so even issues on missing keys point at the enclosing map.
- Reader functions coerce and normalise (single-string `needs`, defaults for `timeout-minutes`, `when`, stages) while recording issues with codes such as `type`, `required`, `unknown_key`, `pattern`, `range`, `too_many`, `enum`.
- `checkSemantics` adds `unknown_stage`, `unknown_job`, `self_dependency`, `later_stage`, `cycle` (with the cycle path, from iterative three-colour DFS), `empty_matrix`, `matrix_too_large`, `expression_syntax`, `unknown_reference`, `invalid_cron`, and the warning `not_yet_executed` naming the implementing ticket.
- `validatePipelineYaml` returns `{ ok, spec, issues }`; `spec` is non-null only without errors, and is the typed, normalised `PipelineSpec` the planner consumes.

### Consequences

- Positive: precise, domain-worded issues with positions; one model for structural and semantic issues; no schema compiler shipped to the browser.
- Positive: normalisation and validation happen in the same walk, so the planner never re-checks shapes.
- Negative: more code to maintain than a declarative schema (four files, roughly 700 lines). Mitigated by `validate.test.ts` covering each code.
- Negative: editors cannot autocomplete from our validator. RY-039 will export a JSON Schema for editor support only; the in-house validator stays authoritative.
- Negative: resource limits must be enforced explicitly in the right order. The matrix size check currently expands combinations before counting; an arithmetic pre-check is required (see quality-attributes section 4, RY-149).
- Rejected: option 1 produces generic messages and needs a second issue model for semantics, and ajv's error paths are JSON Pointers into the converted JS object without source positions; option 2 has the same problems and zod's union errors are hard to make readable.
