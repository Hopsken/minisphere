import { useQuery } from "@tanstack/react-query";

import { Loading } from "@/components/loading";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { didAccountsQuery } from "@/features/did-accounts/queries";

import { NewAccountDialog } from "./new-account-dialog";

export const AccountList = () => {
  const { data, isLoading } = useQuery(didAccountsQuery);

  if (isLoading) {
    return <Loading />;
  }

  if (!data) {
    return null;
  }

  return (
    <ItemGroup className="w-full">
      {data.map((account) => (
        <Item variant={"outline"} key={account.id} size={"xs"}>
          <ItemContent>
            <ItemTitle>{account.username}</ItemTitle>
            <ItemDescription>{account.did}</ItemDescription>
          </ItemContent>
        </Item>
      ))}

      <Item variant={"outline"} size={"xs"}>
        <ItemContent>
          <ItemTitle>Create account</ItemTitle>
        </ItemContent>
        <ItemActions>
          <NewAccountDialog />
        </ItemActions>
      </Item>
    </ItemGroup>
  );
};
