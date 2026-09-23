import { z } from "zod";

export const pdsEndpointSchema = z
  .url({ protocol: /^https$/u })
  .refine(
    (value) => new URL(value).origin === value,
    "Enter an HTTPS origin without a path or trailing slash"
  );

export const patchPlcSchema = z.strictObject({
  expectedHead: z.string().regex(/^b[a-z2-7]{58}$/u),
  pdsEndpoint: pdsEndpointSchema,
});

export type PatchPlc = z.infer<typeof patchPlcSchema>;
