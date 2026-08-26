import { useQuery } from "@tanstack/react-query";

import { didAccountsQuery } from "@/features/did-accounts/queries";

export const AccountList = () => {
  const { data } = useQuery(didAccountsQuery);

  console.log({ data });

  return null;
};
