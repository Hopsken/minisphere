import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: ["**/migrations/*/snapshot.json", "**/routeTree.gen.ts"],
});
