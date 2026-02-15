import { z } from 'zod';
import type { JsonObject, JsonValue } from './json';

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(JsonValueSchema),
]));

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(JsonValueSchema);
