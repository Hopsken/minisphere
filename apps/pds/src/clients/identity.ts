import {
  CompositeDidDocumentResolver,
  CompositeHandleResolver,
  DohJsonHandleResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
} from "@atcute/identity-resolver";

export const createIdentityResolvers = (plcDirectory: string) => ({
  documents: new CompositeDidDocumentResolver<string>({
    methods: {
      plc: new PlcDidDocumentResolver({ apiUrl: plcDirectory }),
      web: new WebDidDocumentResolver(),
    },
  }),
  handles: new CompositeHandleResolver({
    methods: {
      dns: new DohJsonHandleResolver({
        dohUrl: "https://cloudflare-dns.com/dns-query",
      }),
      http: new WellKnownHandleResolver(),
    },
  }),
});
