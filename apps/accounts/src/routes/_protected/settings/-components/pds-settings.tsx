import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { accountKeys, plcAccountQuery } from "@/features/account/queries";
import type { PlcAccount } from "@/features/account/queries";
import { api } from "@/lib/api";

import { pdsEndpointSchema } from "../../../../../schema/plc";
import type { PatchPlc } from "../../../../../schema/plc";

const errorSchema = z.object({ message: z.string() });

export const PdsSettings = ({
  record,
  userId,
}: {
  record: PlcAccount;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const mutation = useMutation({
    mutationFn: async (input: PatchPlc) => {
      const response = await api.account.plc.$patch({ json: input });
      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error(
            "The update could not be confirmed. It may still have reached the directory."
          );
        }
        const parsed = errorSchema.safeParse(await response.json());
        throw new Error(
          parsed.success
            ? parsed.data.message
            : "Could not update the PDS endpoint."
        );
      }
      return response.json();
    },
    onError: (failure) => setError(failure.message),
    onSuccess: (result) => {
      queryClient.setQueryData(accountKeys.plc(userId), result);
      toast.success("PDS endpoint updated.");
    },
    retry: false,
  });

  const reload = async () => {
    setReloading(true);
    try {
      await queryClient.fetchQuery({
        ...plcAccountQuery(userId),
        staleTime: 0,
      });
      setError(null);
    } catch {
      setError(
        "Could not read the latest PLC record. Try again before fixing."
      );
    } finally {
      setReloading(false);
    }
  };

  const current = record.services.atproto_pds?.endpoint;
  const expected = record.expectedPdsEndpoint;
  const matches = current === expected;
  const canFix = pdsEndpointSchema.safeParse(expected).success;
  const busy = mutation.isPending || reloading;

  return (
    <section className="mt-7" aria-labelledby="pds-heading">
      <h2 id="pds-heading" className="text-base font-medium">
        PDS endpoint
      </h2>
      {matches ? (
        <p className="mt-3 flex items-start gap-2 break-all">
          <span>{current}</span>
          <CircleCheckIcon
            className="mt-0.5 size-5 shrink-0 text-green-700"
            aria-label="Matches system configuration"
          />
        </p>
      ) : (
        <>
          <p
            className="mt-4 flex items-center gap-2 text-amber-700"
            role="status"
          >
            <TriangleAlertIcon className="size-5 shrink-0" aria-hidden="true" />
            PDS mismatch
          </p>
          <dl className="divide-border border-border mt-2 divide-y border-b">
            <div className="py-5">
              <dt className="text-muted-foreground text-sm">
                In DID directory
              </dt>
              <dd className="mt-2 break-all">{current ?? "Not set"}</dd>
            </div>
            <div className="py-5">
              <dt className="text-muted-foreground text-sm">
                Expected by system
              </dt>
              <dd className="mt-2 break-all">{expected}</dd>
            </div>
          </dl>
          {canFix ? null : (
            <p className="text-destructive mt-4 text-sm" role="alert">
              The configured PDS endpoint must be an HTTPS origin.
            </p>
          )}
          <Button
            className="mt-6"
            disabled={!canFix || Boolean(error) || busy}
            onClick={() =>
              mutation.mutate({
                expectedHead: record.head,
                pdsEndpoint: expected,
              })
            }
          >
            {mutation.isPending ? (
              <Spinner />
            ) : (
              <WrenchIcon aria-hidden="true" />
            )}
            Fix
          </Button>
        </>
      )}
      {error ? (
        <div className="mt-5 space-y-3" role="alert">
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={reload}>
            {reloading ? <Spinner /> : null}Reload current state
          </Button>
        </div>
      ) : null}
    </section>
  );
};
