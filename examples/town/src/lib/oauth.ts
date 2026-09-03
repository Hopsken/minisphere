import {
  CompositeDidDocumentResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";
import { configureOAuth } from "@atcute/oauth-browser-client";

import type { TownConfiguration } from "@/router";

const isLoopback = () =>
  window.location.protocol === "http:" &&
  ["127.0.0.1", "[::1]"].includes(window.location.hostname);

const fetchPlcDocument: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  url.pathname = `/api/did-documents${url.pathname}`;
  return fetch(new Request(url, request));
};

export const configureTownOAuth = (
  configuration: TownConfiguration
): TownConfiguration => {
  const browserConfiguration = { ...configuration };
  if (isLoopback()) {
    browserConfiguration.redirectUri = `${window.location.origin}/oauth/callback`;
    browserConfiguration.clientId = `http://localhost?${new URLSearchParams({
      redirect_uri: browserConfiguration.redirectUri,
      scope: browserConfiguration.scope,
    }).toString()}`;
  }

  configureOAuth({
    identityResolver: new LocalActorResolver({
      didDocumentResolver: new CompositeDidDocumentResolver({
        methods: {
          plc: new PlcDidDocumentResolver({
            apiUrl: window.location.origin,
            fetch: fetchPlcDocument,
          }),
          web: new WebDidDocumentResolver(),
        },
      }),
      handleResolver: new XrpcHandleResolver({
        serviceUrl: browserConfiguration.handleResolverOrigin,
      }),
    }),
    metadata: {
      client_id: browserConfiguration.clientId,
      redirect_uri: browserConfiguration.redirectUri,
    },
    storageName: "minisphere-town-oauth",
  });
  return browserConfiguration;
};
