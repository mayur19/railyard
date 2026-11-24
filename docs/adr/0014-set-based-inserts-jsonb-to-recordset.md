# ADR-0014: Set-based inserts via jsonb_to_recordset

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-040, RY-060, RY-149

## Context

Creating a run persists up to 1000 jobs and up to 100 steps per job in one transaction while the project row is locked (run numbering). Log flushes insert several chunks at once, every 250 ms per running job. Row-by-row inserts make latency proportional to plan size times network round-trip; building multi-row `VALUES` lists with thousands of positional parameters hits the 65 535 bind-parameter limit of the Postgres protocol and produces unbounded distinct statement texts.

## Decision Drivers

- Constant number of round trips regardless of plan size.
- Fully parameterised SQL (no string concatenation of values).
- Stay under protocol parameter limits for the largest allowed plans.
- Keep SQL readable and the column mapping explicit.

## Considered Options

1. One `INSERT` per row inside the transaction.
2. Multi-row `INSERT ... VALUES ($1,$2,...),(...)` built dynamically.
3. `COPY FROM STDIN` into a temporary table, then `INSERT ... SELECT`.
4. Pass the rows as one JSON parameter and expand server-side with `jsonb_to_recordset`.

## Decision Outcome

Chosen option: **4**. `insertRun` issues exactly three statements: one for the run, one for all jobs, one for all steps. Example (jobs):

```sql
INSERT INTO jobs (organization_id, run_id, key, ..., status, ..., queued_at)
SELECT $1, $2, x.key, ..., x.status, ...,
       CASE WHEN x.status = 'queued' THEN clock_timestamp() END
FROM jsonb_to_recordset($3::jsonb) AS x(key text, job_ref text, ..., needs jsonb, runs_on jsonb, env jsonb)
RETURNING id, key
```

Arrays travel as JSON and are converted with `ARRAY(SELECT jsonb_array_elements_text(...))`. The returned `(id, key)` pairs map step rows to their job ids. Log chunks use the same pattern in `insertChunks`.

### Consequences

- Positive: run creation cost is three round trips plus the planner time; statement text is constant, so plans are cacheable.
- Positive: one bind parameter carries any number of rows; the YAML limits keep the JSON well below practical size limits (a 1000-job plan is a few MB at most).
- Positive: column types are declared in the `AS x(...)` clause, so type errors surface as database errors, not silent coercions.
- Negative: JSON serialisation and parsing overhead (small compared with round trips); `RETURNING` order is not guaranteed, hence the explicit key-to-id map.
- Negative: less familiar to new contributors than `VALUES`; the pattern is documented here and in code comments.
- Rejected: option 1 scales with plan size (1000 jobs plus up to 100 000 steps would be untenable inside a locked transaction); option 2 breaks at the parameter limit; option 3 needs `pg-copy-streams` and temporary tables for no additional benefit at this size.
