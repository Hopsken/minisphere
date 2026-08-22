# Hono utilities

`@minisphere/hono-utils` contains Hono behavior that is shared by more than one application.

The package currently exports `zValidator`, a wrapper around `@hono/zod-validator` that converts validation failures into a consistent `HTTPException(400)`.

Keep application-specific routes, schemas, and error policy in the owning application. Add code here only when multiple Hono applications need the same behavior.

## Usage

```ts
import { zValidator } from "@minisphere/hono-utils";

app.post("/items", zValidator("json", ItemSchema), (context) => {
  const item = context.req.valid("json");
  return context.json(item);
});
```

## Development

```sh
pnpm --filter @minisphere/hono-utils typecheck
```
