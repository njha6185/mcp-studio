export interface DiffEntry {
  path: string;
  kind: "changed" | "missing" | "added";
  expected?: unknown;
  actual?: unknown;
}

/** Recursive structural diff of two JSON values; empty result = equal. */
export function jsonDiff(expected: unknown, actual: unknown, path = "$"): DiffEntry[] {
  if (expected === actual) return [];
  const te = expected === null ? "null" : Array.isArray(expected) ? "array" : typeof expected;
  const ta = actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual;
  if (te !== ta) return [{ path, kind: "changed", expected, actual }];

  if (te === "object") {
    const out: DiffEntry[] = [];
    const eo = expected as Record<string, unknown>;
    const ao = actual as Record<string, unknown>;
    for (const key of Object.keys(eo)) {
      if (!(key in ao)) out.push({ path: `${path}.${key}`, kind: "missing", expected: eo[key] });
      else out.push(...jsonDiff(eo[key], ao[key], `${path}.${key}`));
    }
    for (const key of Object.keys(ao)) {
      if (!(key in eo)) out.push({ path: `${path}.${key}`, kind: "added", actual: ao[key] });
    }
    return out;
  }

  if (te === "array") {
    const ea = expected as unknown[];
    const aa = actual as unknown[];
    const out: DiffEntry[] = [];
    const len = Math.max(ea.length, aa.length);
    for (let i = 0; i < len; i++) {
      if (i >= ea.length) out.push({ path: `${path}[${i}]`, kind: "added", actual: aa[i] });
      else if (i >= aa.length) out.push({ path: `${path}[${i}]`, kind: "missing", expected: ea[i] });
      else out.push(...jsonDiff(ea[i], aa[i], `${path}[${i}]`));
    }
    return out;
  }

  return [{ path, kind: "changed", expected, actual }];
}
