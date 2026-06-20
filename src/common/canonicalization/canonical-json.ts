import { createHash } from 'node:crypto';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function canonicalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, JsonValue>>((canonical, key) => {
        canonical[key] = canonicalizeJsonValue(value[key] as JsonValue);
        return canonical;
      }, {});
  }

  return value;
}

export function serializeCanonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function hashCanonicalJson(value: JsonValue): string {
  return createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
}
