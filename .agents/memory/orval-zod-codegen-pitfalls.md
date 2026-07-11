---
name: Orval + zod codegen pitfalls
description: Two recurring gotchas when generating zod validators and React Query hooks from OpenAPI via orval — read before touching lib/api-spec/orval.config.ts or debugging odd validation/type-check failures in generated api-zod / api-client-react code.
---

## `zod.coerce.string()` breaks required-field validation

`zod.coerce.string()` coerces by calling `String(value)`. When a required query/path
param is **missing** (`undefined`), that becomes the literal string `"undefined"` (9
chars) — which then passes `.min(2)` or any other required/non-empty check instead of
failing. This silently converts "required field missing" into "field present with a
garbage value" instead of a 400.

**Why:** discovered when `GET /api/players/search` with no `query` param returned
`200 []` instead of a validation error, because the generated zod schema used
`zod.coerce.string().min(2)`.

**How to apply:** in orval configs that set `override.zod.coerce`, only coerce
`boolean`/`number` for query/param fields — those types genuinely need string→type
conversion from the wire format. Never add `'string'` to `coerce.query`/`coerce.param`;
plain `zod.string()` is correct for string fields (they already arrive as strings) and
correctly rejects missing values. `.optional()` fields are unaffected either way, since
`ZodOptional` short-circuits on `undefined` before the inner coercion runs.

## Generated react-query hook option types require `queryKey`

Orval's react-query mode generates hooks like `useGetPlayer(id, { query: { enabled } })`
whose declared option type is the real `@tanstack/react-query` `UseQueryOptions` (which
requires `queryKey` — it's `WithRequired<QueryOptions, 'queryKey'>` upstream in
`@tanstack/query-core`), even though the hook's own implementation defaults `queryKey`
internally via the paired `getXQueryOptions`/`getXQueryKey` helpers when the caller omits
it. Passing only `{ enabled: ... }` (the intended usage pattern) fails `tsc` with
"Property 'queryKey' is missing" — this is a gap in orval's generated types, not a bug
in the calling code.

**Why:** confirmed by reading `@tanstack/react-query`'s and `@tanstack/query-core`'s own
`.d.ts` — `QueryObserverOptions` explicitly does `WithRequired<QueryOptions, 'queryKey'>`.

**How to apply:** at each call site that needs `enabled`/`retry`/etc. without wanting to
hand-roll the query key, pass the matching exported `getXQueryKey(...)` helper explicitly
(e.g. `{ query: { queryKey: getGetPlayerQueryKey(playerId), enabled: !!playerId } }`).
This is exactly the key the hook would have defaulted to internally, so behavior is
unchanged — it only satisfies the type checker.
