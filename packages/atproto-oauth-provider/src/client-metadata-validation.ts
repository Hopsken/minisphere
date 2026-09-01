import type { PublicClientMetadataDocument } from "./protocol-validation";

export const assertUnique = (values: string[], field: string) => {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${field} must not contain duplicate values`);
  }
};

const parseUrl = (value: string, field: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be a URL`);
  }

  if (url.username || url.password || url.hash) {
    throw new TypeError(`${field} must not contain credentials or a fragment`);
  }
  return url;
};

const rawAuthority = (value: string) => {
  const authorityStart = value.indexOf("//") + 2;
  const authorityEnd = value.slice(authorityStart).search(/[/?#]/u);
  return authorityEnd === -1
    ? value.slice(authorityStart)
    : value.slice(authorityStart, authorityStart + authorityEnd);
};

const rawPath = (value: string) => {
  const pathStart = value.indexOf("/", value.indexOf("//") + 2);
  if (pathStart === -1) {
    return "/";
  }
  const pathEnd = value.slice(pathStart).search(/[?#]/u);
  return pathEnd === -1
    ? value.slice(pathStart)
    : value.slice(pathStart, pathStart + pathEnd);
};

const isIpAddress = (hostname: string) => {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return true;
  }
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
};

const isLocalHostname = (hostname: string) =>
  !hostname.includes(".") ||
  [".example", ".internal", ".invalid", ".local", ".localhost", ".test"].some(
    (suffix) => hostname.endsWith(suffix)
  );

export const assertPublicClientId = (clientId: string) => {
  const url = parseUrl(clientId, "client_id");
  if (
    !clientId.startsWith("https://") ||
    url.protocol !== "https:" ||
    rawAuthority(clientId).includes(":") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/") ||
    url.pathname !== rawPath(clientId)
  ) {
    throw new TypeError(
      "client_id must use HTTPS without a port and include a metadata path"
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (isIpAddress(hostname) || isLocalHostname(hostname)) {
    throw new TypeError("client_id must use a public hostname");
  }
  return url;
};

const assertHttpsMetadataUrl = (value: string, field: string) => {
  const url = parseUrl(value, field);
  if (url.protocol !== "https:") {
    throw new TypeError(`${field} must use HTTPS`);
  }
  return url;
};

export const assertLoopbackRedirect = (value: string) => {
  const url = parseUrl(value, "redirect_uri");
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")
  ) {
    throw new TypeError(
      "Localhost clients require an IP loopback redirect URI"
    );
  }
};

const assertCustomNativeRedirect = (value: string, clientUrl: URL) => {
  parseUrl(value, "redirect_uri");
  const match = /^(?<scheme>[a-z][a-z\d+.-]*):\/(?!\/).+/iu.exec(value);
  const expectedScheme = clientUrl.hostname.split(".").toReversed().join(".");
  if (
    !match ||
    match.groups?.scheme?.toLowerCase() !== expectedScheme.toLowerCase()
  ) {
    throw new TypeError(
      "Native redirect URI scheme must be the reversed client_id hostname"
    );
  }
};

export const assertRedirectUri = (
  value: string,
  applicationType: "native" | "web",
  clientUrl: URL
) => {
  if (applicationType === "web") {
    const redirectUrl = assertHttpsMetadataUrl(value, "redirect_uri");
    if (
      isIpAddress(redirectUrl.hostname) ||
      isLocalHostname(redirectUrl.hostname) ||
      rawAuthority(value).endsWith(":443")
    ) {
      throw new TypeError(
        "Web redirect_uri must use public HTTPS without its default port"
      );
    }
    return;
  }

  if (value.toLowerCase().startsWith("https://")) {
    const redirectUrl = assertHttpsMetadataUrl(value, "redirect_uri");
    if (
      redirectUrl.origin !== clientUrl.origin ||
      rawAuthority(value).endsWith(":443")
    ) {
      throw new TypeError(
        "Native HTTPS redirect URI must have the client_id origin"
      );
    }
    return;
  }

  assertCustomNativeRedirect(value, clientUrl);
};

export const assertClientPresentationUrls = (
  metadata: PublicClientMetadataDocument,
  clientUrl: URL
) => {
  if (metadata.client_uri) {
    const clientUri = assertHttpsMetadataUrl(metadata.client_uri, "client_uri");
    const parentPath = clientUri.pathname.endsWith("/")
      ? clientUri.pathname
      : `${clientUri.pathname}/`;
    if (
      clientUri.origin !== clientUrl.origin ||
      (clientUri.pathname !== clientUrl.pathname &&
        !clientUrl.pathname.startsWith(parentPath))
    ) {
      throw new TypeError("client_uri must contain the client_id URL");
    }
  }
  for (const [field, value] of [
    ["logo_uri", metadata.logo_uri],
    ["policy_uri", metadata.policy_uri],
    ["tos_uri", metadata.tos_uri],
  ] as const) {
    if (value) {
      assertHttpsMetadataUrl(value, field);
    }
  }
};
