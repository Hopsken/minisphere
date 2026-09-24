import m0000 from "./20260820053318_init/migration.sql";
import m0001 from "./20260924003119_add-blob-references/migration.sql";

export default {
  migrations: {
    "20260820053318_init": m0000,
    "20260924003119_add-blob-references": m0001,
  },
};
