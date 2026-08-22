import { toBase64Url } from "@atcute/multibase";

export const randomBytes = (length: number): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(length)));
