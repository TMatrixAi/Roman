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

## Inline (non-`$ref`) request/response body schemas collide with generated type files

Defining a request or response body inline in `openapi.yaml` (instead of `$ref`-ing a
named `components/schemas` entry) makes orval's zod generator emit a const in
`generated/api.ts` *and* a same-named standalone type in `generated/types/`, which
collide (`TS2308: already exported a member`). Always define bodies as named
`components/schemas` entries and `$ref` them.

**Why:** hit this converting several inline request/response bodies to named schemas —
the collision only appears once a name is actually reused between the two generated
outputs, so it can sit latent for a long time before breaking.

**How to apply:** when adding any new endpoint body in this repo's `openapi.yaml`, always
add a named schema and `$ref` it. Also: the zod const name orval generates for a body is
derived from **`operationId` + `Body`/`Response`**, not from the `$ref`'d schema's own
component name — e.g. an operation `bulkDeletePredictions` whose response `$ref`s a
schema named `BulkDeletePredictionsResult` still generates a zod const called
`BulkDeletePredictionsResponse`, not `BulkDeletePredictionsResult` (that name only exists
as a plain TS type in `generated/types/`). Always grep the actual generated
`lib/api-zod/src/generated/api.ts` for the real const name before importing it — don't
assume it matches your schema's component name.

## `lib/api-zod/src/index.ts` has a latent duplicate-export bug, and running `pnpm run codegen` DOES reintroduce it

This hand-written barrel file recurringly ends up with each `export * from "./generated/..."`
line duplicated twice — once double-quoted, once single-quoted. It's harmless on its own
(TS allows duplicate `export *` of the same path), but becomes a hard `TS2308` the moment a
real name collision exists between the two generated modules. Confirmed by direct
reproduction: running `pnpm run codegen` in `lib/api-spec` reintroduces the duplicate lines
in this file even though `orval.config.ts` only targets the `generated/` output dirs and
never references `index.ts` — the exact mechanism is still unknown, but the effect is
reliably reproducible, so treat it as a real side effect of codegen, not a stale artifact
from an earlier session. Always `cat lib/api-zod/src/index.ts` and rewrite it to the clean
two-line form immediately after every codegen run, right before the final typecheck.

## A named `$ref`'d component schema can still collide if its name equals the operationId-derived name

Naming a response's `components/schemas` entry to literally match what orval derives from
`operationId + "Body"/"Response"` reproduces the exact same `TS2308` collision as an inline
body (see above), because the zod const (in `generated/api.ts`, named from `operationId`)
and the plain TS type (in `generated/types/`, named from the schema's own component name)
end up as two same-named exports. E.g. operation `removeDuplicatePredictions` with its
response `$ref`ing a schema literally named `RemoveDuplicatePredictionsResponse` collides;
renaming the schema to `RemoveDuplicatePredictionsResult` (matching the existing repo
convention seen in `BulkDeletePredictionsResult`) fixes it with no behavior change.

**How to apply:** always suffix new response/body component schema names with `Result`
(not `Response`/`Body`) so they can never textually match the operationId-derived zod const
name — the zod const alone is what routes import to `.parse(...)`.

## A nullable date field's `oneOf` order controls whether `null` survives parsing

For `oneOf: [{type: string, format: date-time}, {type: "null"}]`, orval generates
`zod.union([zod.coerce.date(), zod.null()])`. `zod.coerce.date()` calls `new Date(null)`,
which succeeds (epoch 1970-01-01) instead of failing, so a real `null` silently becomes a
fake timestamp — `zod.union` never even reaches the `zod.null()` branch. Confirmed live:
an unresolvable fixture time meant to serialize as `scheduledStart: null` came back as
`"1970-01-01T00:00:00.000Z"` with `timeConfirmed: false`, defeating the whole "null means
unconfirmed" contract for any client that doesn't also check `timeConfirmed`.

**How to apply:** for any nullable date/date-time field, list `type: "null"` **first** in
the `oneOf` — orval preserves array order, so this produces `zod.union([zod.null(),
zod.coerce.date()])` and a real `null` matches correctly. After changing, regenerate and
grep the actual `lib/api-zod/src/generated/api.ts` union order to confirm — don't just trust
the `openapi.yaml` edit took effect.
