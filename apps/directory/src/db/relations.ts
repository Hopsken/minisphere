import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  dids: {
    operations: r.many.operations({
      from: r.dids.did,
      to: r.operations.did,
    }),
  },
}));
