import type { JsonSchema } from "./types";

/**
 * Minimal JSON Schema checker covering the constructs tool outputSchemas
 * actually use: type, required, properties, items, enum, const, anyOf/oneOf.
 * Returns human-readable issues; empty array = valid (as far as we check).
 */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema | undefined,
  path = "$"
): string[] {
  if (!schema || typeof schema !== "object") return [];
  const issues: string[] = [];

  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives?.length) {
    const passes = alternatives.some(
      (alt) => validateAgainstSchema(value, alt, path).length === 0
    );
    if (!passes) issues.push(`${path}: matches none of the ${alternatives.length} allowed variants`);
    return issues;
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    issues.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    issues.push(`${path}: value not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(", ")}]`);
  }

  const types = schema.type
    ? Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
    : [];
  if (types.length) {
    const actual =
      value === null
        ? "null"
        : Array.isArray(value)
          ? "array"
          : typeof value;
    const ok = types.some((t) =>
      t === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : t === "number"
          ? typeof value === "number"
          : t === actual
    );
    if (!ok) {
      issues.push(`${path}: expected ${types.join(" | ")}, got ${actual}`);
      return issues; // deeper checks would be noise on the wrong type
    }
  }

  if (schema.properties && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) issues.push(`${path}.${key}: required property missing`);
    }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in obj) issues.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`));
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, i) =>
      issues.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`))
    );
  }

  return issues;
}
