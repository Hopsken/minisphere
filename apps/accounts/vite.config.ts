import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const publicUrl = process.env.PUBLIC_URL;

  return {
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
      allowedHosts: publicUrl ? [new URL(publicUrl).hostname] : [],
      host: "localhost",
      port: 8790,
      strictPort: true,
    },
  };
});
