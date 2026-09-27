import { z } from "zod";

export const birthDateSchema = z.iso
  .date("Enter a valid date")
  .refine((value) => value >= "1900-01-01", "Enter a date after 1900")
  .refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    "Your birthday can’t be in the future"
  );

export const putBirthDateSchema = z.strictObject({
  birthDate: birthDateSchema,
});

export type PutBirthDate = z.infer<typeof putBirthDateSchema>;
