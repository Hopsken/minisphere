export const createHostedHandle = (
  username: string,
  domain: string
): `${string}.${string}` => `${username}.${domain}`;
