import m0000 from "./20260820053318_init/migration.sql";
import m0001 from "./20260924003119_add-blob-references/migration.sql";
import m0002 from "./20260925123407_add-event-outbox/migration.sql";

export default {
  migrations: {
    "20260820053318_init": m0000,
    "20260924003119_add-blob-references": m0001,
    "20260925123407_add-event-outbox": m0002,
  },
};
