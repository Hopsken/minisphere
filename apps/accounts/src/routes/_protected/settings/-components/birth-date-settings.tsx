import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SubmitEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { accountKeys, birthDateQuery } from "@/features/account/queries";
import { api } from "@/lib/api";

import { putBirthDateSchema } from "../../../../../schema/birth-date";
import type { PutBirthDate } from "../../../../../schema/birth-date";

const errorSchema = z.object({ message: z.string() });

const BirthDateForm = ({
  saved,
  userId,
}: {
  saved: string | null;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(saved ?? "");
  const mutation = useMutation({
    mutationFn: async (input: PutBirthDate) => {
      const response = await api.account["birth-date"].$put({ json: input });
      if (!response.ok) {
        const parsed = errorSchema.safeParse(
          await response.json().catch(() => null)
        );
        throw new Error(
          parsed.success ? parsed.data.message : "Could not save your birthday."
        );
      }
      return response.json();
    },
    // The form shows the error inline instead of the global toast.
    onError: () => null,
    onSuccess: ({ birthDate }) => {
      queryClient.setQueryData(accountKeys.birthDate(userId), birthDate);
      toast.success("Birthday saved.");
    },
  });
  const parsed = putBirthDateSchema.safeParse({ birthDate: value });
  const invalid = value !== "" && !parsed.success;

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsed.success && !mutation.isPending) {
      mutation.mutate(parsed.data);
    }
  };

  return (
    <form className="mt-5 grid gap-2" onSubmit={submit}>
      <div className="flex gap-3">
        <Input
          type="date"
          aria-labelledby="birth-date-heading"
          className="w-auto"
          min="1900-01-01"
          max={new Date().toISOString().slice(0, 10)}
          value={value}
          aria-invalid={invalid}
          onChange={(event) => {
            setValue(event.target.value);
            mutation.reset();
          }}
        />
        <Button
          type="submit"
          disabled={!parsed.success || value === saved || mutation.isPending}
        >
          {mutation.isPending ? <Spinner /> : null}
          Save
        </Button>
      </div>
      {invalid ? (
        <p className="text-destructive text-sm" role="alert">
          {parsed.error.issues[0]?.message}
        </p>
      ) : null}
      {mutation.error ? (
        <p className="text-destructive text-sm" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
    </form>
  );
};

export const BirthDateSettings = ({ userId }: { userId: string }) => {
  const birthDate = useQuery(birthDateQuery(userId));
  return (
    <section className="mt-10" aria-labelledby="birth-date-heading">
      <h2 id="birth-date-heading" className="text-base font-medium">
        Birthday
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Apps see only whether you are over 13, 16, or 18.
      </p>
      {birthDate.isPending ? (
        <p className="text-muted-foreground mt-5 flex items-center gap-2 text-sm">
          <Spinner />
          Loading…
        </p>
      ) : null}
      {birthDate.isSuccess ? (
        <BirthDateForm saved={birthDate.data} userId={userId} />
      ) : null}
    </section>
  );
};
