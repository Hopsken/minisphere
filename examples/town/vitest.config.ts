import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          DEV_HANDLE_RESOLVER_ORIGIN: "https://handle-registry.test",
          PLC_DIRECTORY_ORIGIN: "https://plc.test",
          PUBLIC_URL: "https://town.hopsken.dev",
        },
        outboundService: "minisphere-town-test-services",
        workers: [
          {
            modules: true,
            name: "minisphere-town-test-services",
            routes: [
              "https://alice.example.com/*",
              "https://cloudflare-dns.com/*",
              "https://handle-registry.test/*",
              "https://plc.test/*",
            ],
            script: `
              export default {
                fetch(request) {
                  const url = new URL(request.url);
                  if (
                    url.hostname === "handle-registry.test" &&
                    url.pathname === "/xrpc/com.atproto.identity.resolveHandle" &&
                    url.searchParams.get("handle") === "alice.r2d2.test"
                  ) {
                    return Response.json({
                      did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
                    });
                  }
                  if (
                    url.hostname === "alice.example.com" &&
                    url.pathname === "/.well-known/atproto-did"
                  ) {
                    return new Response("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa");
                  }
                  if (
                    url.hostname === "plc.test" &&
                    url.pathname === "/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
                  ) {
                    return Response.json({
                      "@context": ["https://www.w3.org/ns/did/v1"],
                      id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
                      alsoKnownAs: ["at://alice.r2d2.test"],
                      service: [{
                        id: "#atproto_pds",
                        type: "AtprotoPersonalDataServer",
                        serviceEndpoint: "https://pds.hopsken.dev"
                      }],
                      verificationMethod: []
                    });
                  }
                  if (
                    url.hostname === "plc.test" &&
                    url.pathname === "/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/data"
                  ) {
                    return Response.json({
                      did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
                      alsoKnownAs: ["at://alice.r2d2.test"],
                      services: {},
                      verificationMethods: {},
                      rotationKeys: []
                    });
                  }
                  return Response.json({ message: "DID not registered" }, { status: 404 });
                }
              };
            `,
          },
        ],
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
