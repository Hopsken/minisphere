const INVITE_CODE_BYTES = 32;
const INVITE_CODE_KEY_PREFIX = "invite:";
const INVITE_CODE_TTL_SECONDS = 2 * 60 * 60;

const getInviteCodeKey = (inviteCode: string): string =>
  `${INVITE_CODE_KEY_PREFIX}${inviteCode}`;

export const generateInviteCode = async (
  inviteCodes: KVNamespace
): Promise<string> => {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES));
  const inviteCode = btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

  await inviteCodes.put(getInviteCodeKey(inviteCode), "1", {
    expirationTtl: INVITE_CODE_TTL_SECONDS,
  });
  return inviteCode;
};

export const verifyInviteCode = async (
  inviteCodes: KVNamespace,
  inviteCode: string
): Promise<boolean> =>
  (await inviteCodes.get(getInviteCodeKey(inviteCode))) !== null;

export const deleteInviteCode = (
  inviteCodes: KVNamespace,
  inviteCode: string
): Promise<void> => inviteCodes.delete(getInviteCodeKey(inviteCode));
