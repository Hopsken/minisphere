import { HTTPException } from "hono/http-exception";

export const xrpcError = (error: string, message: string) =>
  new HTTPException(400, {
    message,
    res: Response.json({ error, message }, { status: 400 }),
  });
