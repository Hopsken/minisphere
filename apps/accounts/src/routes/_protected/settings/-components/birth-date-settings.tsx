import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SubmitEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { accountKeys, birthDateQuery } from "@/features/account/queries";
import { api } from "@/lib/api";

import { putBirthDateSchema } from "../../../../../schema/birth-date";
import type { PutBirthDate } from "../../../../../schema/birth-date";

const errorSchema = z.object({ message: z.string() });

// Birth dates are calendar dates; format them in UTC so no time zone shifts the day.
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: "long",
  timeZone: "UTC",
});
const months = Array.from({ length: 12 }, (_, index) => ({
  label: monthFormat.format(Date.UTC(2000, index, 1)),
  value: String(index + 1).padStart(2, "0"),
}));

const formatBirthDate = (birthDate: string) =>
  dateFormat.format(new Date(`${birthDate}T00:00:00Z`));

type Field = "day" | "year";

/** Names the field to fix, so the message can say what is wrong with it. */
const findInvalidField = (
  year: string,
  month: string,
  day: string
): { field: Field; message: string } | null => {
  const thisYear = new Date().getUTCFullYear();
  if (Number(year) < 1900 || Number(year) > thisYear) {
    return { field: "year", message: `Enter a year from 1900 to ${thisYear}` };
  }
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(day) < 1 || Number(day) > days) {
    const name = months[Number(month) - 1]?.label ?? "";
    return {
      field: "day",
      message: Number(day) > days ? `${name} has ${days} days` : "Enter a day",
    };
  }
  return null;
};

const EditDialog = ({
  saved,
  userId,
}: {
  saved: string | null;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const monthId = useId();
  const dayId = useId();
  const yearId = useId();
  const errorId = useId();
  const [savedYear = "", savedMonth = null, savedDay = ""] =
    saved?.split("-") ?? [];
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(savedYear);
  const [month, setMonth] = useState<string | null>(savedMonth);
  const [day, setDay] = useState(savedDay.replace(/^0/u, ""));
  const [invalid, setInvalid] = useState<{
    field: Field | "date";
    message: string;
  } | null>(null);
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
    // The dialog shows the error inline instead of the global toast.
    onError: () => null,
    onSuccess: ({ birthDate }) => {
      queryClient.setQueryData(accountKeys.birthDate(userId), birthDate);
      setOpen(false);
      toast.success("Birthday saved.");
    },
  });
  const complete = Boolean(month) && day !== "" && year.length === 4;
  const error = invalid?.message ?? mutation.error?.message;
  const invalidField = (field: Field) =>
    invalid?.field === field || invalid?.field === "date";

  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setYear(savedYear);
      setMonth(savedMonth);
      setDay(savedDay.replace(/^0/u, ""));
      setInvalid(null);
      mutation.reset();
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!month) {
      return;
    }
    const field = findInvalidField(year, month, day);
    if (field) {
      setInvalid(field);
      return;
    }
    const parsed = putBirthDateSchema.safeParse({
      birthDate: `${year}-${month}-${day.padStart(2, "0")}`,
    });
    if (!parsed.success) {
      setInvalid({
        field: "date",
        message: parsed.error.issues[0]?.message ?? "Enter a valid date",
      });
      return;
    }
    if (!mutation.isPending) {
      mutation.mutate(parsed.data);
    }
  };

  const edit = () => {
    setInvalid(null);
    mutation.reset();
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      {saved ? (
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          Change
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button className="mt-5" />}>
          <PlusIcon aria-hidden="true" />
          Add birthday
        </DialogTrigger>
      )}
      <DialogContent>
        <form className="grid gap-6" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {saved ? "Change birthday" : "Add birthday"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[1fr_4.5rem_5.5rem] gap-3">
            <div className="grid gap-2">
              <Label htmlFor={monthId}>Month</Label>
              <Select
                items={months}
                value={month}
                onValueChange={(value) => {
                  setMonth(value);
                  edit();
                }}
              >
                <SelectTrigger id={monthId} className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={dayId}>Day</Label>
              <Input
                id={dayId}
                autoComplete="bday-day"
                inputMode="numeric"
                maxLength={2}
                value={day}
                aria-invalid={invalidField("day")}
                aria-describedby={invalidField("day") ? errorId : undefined}
                onChange={(event) => {
                  setDay(event.target.value.replaceAll(/\D/gu, ""));
                  edit();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={yearId}>Year</Label>
              <Input
                id={yearId}
                autoComplete="bday-year"
                inputMode="numeric"
                maxLength={4}
                value={year}
                aria-invalid={invalidField("year")}
                aria-describedby={invalidField("year") ? errorId : undefined}
                onChange={(event) => {
                  setYear(event.target.value.replaceAll(/\D/gu, ""));
                  edit();
                }}
              />
            </div>
          </div>
          {error ? (
            <p
              id={errorId}
              className="text-destructive -mt-2 text-sm"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!complete || mutation.isPending}>
              {mutation.isPending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      {birthDate.isSuccess && birthDate.data ? (
        <div className="border-border mt-5 flex items-center justify-between gap-4 border-y py-4">
          <p className="font-medium">{formatBirthDate(birthDate.data)}</p>
          <EditDialog saved={birthDate.data} userId={userId} />
        </div>
      ) : null}
      {birthDate.isSuccess && !birthDate.data ? (
        <EditDialog saved={null} userId={userId} />
      ) : null}
    </section>
  );
};
