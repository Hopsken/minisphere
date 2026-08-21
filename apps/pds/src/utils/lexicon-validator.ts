import { safeParse } from "@atcute/lexicons/validations";
import type {
  ArraySchema,
  BaseSchema,
  InferOutput,
  ObjectSchema,
  OptionalSchema,
} from "@atcute/lexicons/validations";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";

const validate = <Schema extends BaseSchema>(
  schema: Schema,
  value: unknown
): InferOutput<Schema> => {
  const result = safeParse(schema, value);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return result.value;
};

const isOptionalSchema = (schema: BaseSchema): schema is OptionalSchema =>
  schema.type === "optional";

const isArraySchema = (schema: BaseSchema): schema is ArraySchema =>
  schema.type === "array";

const unwrapOptional = (schema: BaseSchema): BaseSchema => {
  let current = schema;
  while (isOptionalSchema(current)) {
    current = current.wrapped;
  }
  return current;
};

const coerceQueryValue = (schema: BaseSchema, value: string) => {
  const unwrapped = unwrapOptional(schema);

  if (unwrapped.type === "boolean") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return null;
  }

  if (unwrapped.type === "integer") {
    return /^-?\d+$/u.test(value) ? Number(value) : null;
  }

  return value;
};

export const lexiconJsonValidator = <Schema extends BaseSchema>(
  schema: Schema
) => validator("json", (value) => validate(schema, value));

export const lexiconQueryValidator = <Schema extends ObjectSchema>(
  schema: Schema
) =>
  validator("query", (query) => {
    const input: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(schema.shape)) {
      const value = query[key];
      const values = (Array.isArray(value) ? value : [value]).filter(
        (item): item is string => typeof item === "string" && item !== ""
      );
      if (values.length === 0) {
        continue;
      }

      const unwrapped = unwrapOptional(fieldSchema);
      const itemSchema = isArraySchema(unwrapped) ? unwrapped.item : unwrapped;
      const coerced = values.map((item) => coerceQueryValue(itemSchema, item));
      input[key] =
        isArraySchema(unwrapped) || coerced.length > 1 ? coerced : coerced[0];
    }

    return validate(schema, input);
  });
