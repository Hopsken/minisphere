import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const rotationKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const rotationKeyMultikey = await rotationKey.exportPrivateKey("multikey");
  process.env.PDS_HOSTNAME = "pds.test";
  process.env.PDS_ROTATION_KEY = rotationKeyMultikey;

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            PDS_HOSTNAME: "pds.test",
            PDS_ROTATION_KEY: rotationKeyMultikey,
          },
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    test: {
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: ["@atcute/crypto", "@atproto/crypto"],
          },
        },
      },
    },
  };
});
