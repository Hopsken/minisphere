export const isEmailAllowed = (email: string, allowlist: string) => {
  const normalized = email.trim().toLowerCase();
  const [, domain] = normalized.split("@");
  return allowlist.split(",").some((value) => {
    const entry = value.trim().toLowerCase();
    return (
      entry !== "" &&
      (entry === "*" || entry === normalized || entry === domain)
    );
  });
};
