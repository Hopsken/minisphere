import { resolveConfig } from "../config";

const forwardedHeaders = ["Authorization", "Content-Type"];

/**
 * Forwards a session method to Accounts, which owns app-password sessions
 * (ADR 0013). Password clients send them to the PDS named in the DID document.
 */
export const forwardSessionRequest = async (request: Request, lxm: string) => {
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  const response = await fetch(
    `${resolveConfig().accountsOrigin}/xrpc/${lxm}`,
    {
      body: request.method === "POST" ? request.body : null,
      headers,
      method: request.method,
      redirect: "manual",
    }
  );
  // deleteSession has no output; a declared JSON type would break clients.
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  const contentType = response.headers.get("Content-Type");
  if (contentType) {
    responseHeaders.set("Content-Type", contentType);
  }
  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
  });
};
