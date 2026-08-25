import { queryOptions } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";

export const authKeys = {
  session: ["auth", "session"] as const,
};

export const sessionQuery = queryOptions({
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) {
      throw error;
    }
    return data;
  },
  queryKey: authKeys.session,
  staleTime: 0,
});
