import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  out: "./src/sequencer/migrations",
  schema: "./src/sequencer/schema.ts",
});
