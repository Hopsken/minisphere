import type { PropsWithChildren } from "react";

import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

export const Loading = (props: PropsWithChildren) => (
  <Item variant="muted">
    <ItemMedia>
      <Spinner />
    </ItemMedia>
    <ItemContent>
      <ItemTitle className="line-clamp-1">
        {props.children ?? "Loading..."}
      </ItemTitle>
    </ItemContent>
  </Item>
);
