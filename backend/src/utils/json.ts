import type { Prisma } from '@prisma/client';

// Re-export Prisma JSON types so the entire codebase shares ONE JsonValue type.
export type JsonValue = Prisma.JsonValue;
export type JsonObject = Prisma.JsonObject;
export type JsonArray = Prisma.JsonArray;

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asJsonObject(v: unknown): JsonObject | null {
  return isJsonObject(v) ? (v as JsonObject) : null;
}

export function getString(obj: unknown, key: string): string | undefined {
  const o = asJsonObject(obj);
  if (!o) return undefined;
  const v = (o as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}


