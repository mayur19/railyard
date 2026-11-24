# ADR-0016: Fastify 5 with zod validation at every boundary

- Status: Accepted
- Date: 2026-11-24
- Tickets: RY-002

## Context

The API needs routing, cookies, hooks for authentication, structured logging, request ids, body limits and a single error format. Input arrives from browsers (JSON bodies, query strings, route params, headers), from environment variables at boot, and from the database. Types must be shared with the SPA so request and response shapes cannot drift.

## Decision Drivers

- TypeScript-first, strict mode, minimal magic.
- Lifecycle hooks for session loading and per-route guards.
- First-class pino integration and request ids.
- One schema library usable in browser and server, producing typed values and field-level errors.
- Small dependency footprint.

## Considered Options

1. Express 4/5 with hand-written middleware and Joi.
2. NestJS with class-validator.
3. Fastify 5 with JSON Schema (`ajv`) route schemas.
4. Fastify 5 with zod schemas from `@railyard/shared`, parsed explicitly in handlers via `parse(schema, input)`.

## Decision Outcome

Chosen option: **4**.

- Fastify provides hooks (`onRequest` security headers and `x-request-id`; `preHandler` session loader; per-route `guard(permission)`), `genReqId` (accepts a well-formed `X-Request-Id` of 8-64 safe characters, else a UUID), `bodyLimit` (512 KiB), `trustProxy` (ADR-0019) and `@fastify/cookie`.
- zod schemas live in `packages/shared/src/api/schemas.ts`; handlers call `parse(schema, request.body)` which throws `400 VALIDATION_FAILED` with `details: [{ path, message }]`.
- Configuration is a zod schema (`config/env.ts`) that lists every problem at once and enforces cross-field rules (`COOKIE_SECURE` must be true in production).
- Errors are `AppError(status, code, message, details?)` mapped to the envelope by one error handler; unknown errors are logged with the request id and returned as `500 INTERNAL` without internals.

### Consequences

- Positive: the SPA imports the same schemas for form validation; the envelope types are shared.
- Positive: explicit `parse` calls make validation visible in each handler and testable without HTTP.
- Negative: Fastify's built-in JSON Schema serialisation speed-ups are not used for responses. Response sizes are small except logs, which are bounded by `limit`.
- Negative: OpenAPI is maintained by hand (`docs/api/openapi.yaml`) instead of derived from route schemas; the pending-route test keeps the route list honest.
- Rejected: option 1 lacks typed hooks and needs more glue; option 2 brings decorators, DI and a large framework for a small API; option 3 duplicates schemas between JSON Schema and TypeScript types.
