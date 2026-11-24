# ADR-0006: In-house expression language for `if` conditions and `${{ }}` interpolation

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-032

## Context

Pipelines need conditions (`if: branch == 'main' && matrix.os != 'windows'`) and templating in names, env values and scripts (`echo ${{ matrix.node }}`). Pipeline files are untrusted input submitted by any user with `run:create` and evaluated on the API server during planning. The language must be statically checkable so the validator can report unknown references with a path before a run is created.

## Decision Drivers

- No arbitrary code execution on the API host; no prototype access, no loops, bounded evaluation cost.
- Static reference checking against the job's scope (`matrix.<axis>`, `env.<NAME>`, `branch`, `sha`, `event`, `run_number`).
- Small, documented grammar users can learn in minutes.
- Deterministic results; same input, same output, in browser and server.

## Considered Options

1. JavaScript `eval` / `new Function` / `vm` sandbox.
2. An embedded general-purpose expression library (for example a JSONata, CEL or JEXL implementation).
3. Mustache/Handlebars-style templates for interpolation and a separate boolean language for `if`.
4. In-house recursive-descent language shared by `if` and `${{ }}`.

## Decision Outcome

Chosen option: **4, in-house language** in `packages/shared/src/pipeline/expression.ts`.

Grammar:

```
expr    := or
or      := and ( '||' and )*
and     := unary ( '&&' unary )*
unary   := '!' unary | compare
compare := primary ( ( '==' | '!=' ) primary )?
primary := STRING | NUMBER | true | false | null
         | IDENT ( '.' IDENT )*                 reference
         | IDENT '(' expr ( ',' expr )* ')'     startsWith | endsWith | contains (exactly 2 args)
         | '(' expr ')'
```

- Expressions are capped at 1024 characters. Evaluation is a tree walk with no loops, so cost is linear in expression size.
- Equality is loose by string coercion across types (`matrix.node == '20'` is true for the number 20), `null` equals only `null`. Truthiness: `null`, `false`, `0`, `''` are false.
- `collectReferences` returns every dotted path for static checks; `checkReference` validates them against a `ReferenceScope` (matrix axes, including keys introduced only by `include`, and env names visible at that point).
- Unknown references throw at evaluation, but the validator rejects them earlier with `unknown_reference`.
- `${{ ... }}` placeholders are found with a non-greedy pattern, parsed with the same parser, and stringified (`null` becomes empty string). Unterminated placeholders are an `expression_syntax` error.

### Consequences

- Positive: no code execution surface; complete static checking; one language for both uses.
- Positive: grammar is small enough to document in one table in the user guide (RY-148).
- Negative: no arithmetic, no ordering comparisons, no status functions; job outcome handling is expressed by `when` instead (ADR-0009). Adding operators later is backwards compatible.
- Negative: users coming from other CI systems may expect `${{ secrets.X }}`; secret references will be added with RY-072 as a new reference root that resolves at execution time on the runner, never at planning time.
- Rejected: option 1 is unsafe on untrusted input; option 2 brings far larger surface than needed and makes static scope checks hard; option 3 splits the mental model and the validator.
