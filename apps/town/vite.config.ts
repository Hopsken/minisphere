import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { UserConfig } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = env.VITE_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  const config: UserConfig = {
    plugins: [
      tanstackRouter({ autoCodeSplitting: true, target: "react" }),
      react(),
      tailwindcss(),
      cloudflare({ inspectorPort: 0 }),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      host: "127.0.0.1",
      port: 5174,
    },
  };
  if (allowedHosts) {
    config.server = { ...config.server, allowedHosts };
  }
  return config;
});
