import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An XRPC error; the route boundary renders it as `{ error, message }`. */
export class XrpcError extends HTTPException {
  readonly error: string;

  constructor(status: ContentfulStatusCode, error: string, message: string) {
    super(status, { message });
    this.error = error;
  }
}
