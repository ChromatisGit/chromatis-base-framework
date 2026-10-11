/**
 * What can be read from a Zod schema without depending on its internals: its
 * JSON Schema, converted by Zod itself. Editor support (`infra/scripts`) and
 * the declaration checks in `module.ts` share this view.
 */
import { z } from "zod";

export type JsonSchema = { [key: string]: unknown };

const isRecord = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isZodSchema = (value: unknown): value is z.ZodType =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { safeParse?: unknown }).safeParse === "function";

/**
 * The JSON Schema of what an author may write: the input side of the schema,
 * so defaults make a key optional and transforms are looked through. Checks
 * JSON Schema cannot express (`refine`, `superRefine`, custom types) are left
 * out; the Zod schema stays the validation authority. Draft 07 is the widest
 * supported by editors.
 */
export function toInputJsonSchema(
  schema: z.ZodType,
  options: Readonly<{ cycles?: "ref" | "throw" }> = {},
): JsonSchema {
  return z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
    cycles: options.cycles ?? "ref",
  }) as JsonSchema;
}

function resolveReference(root: JsonSchema, reference: string): unknown {
  if (reference === "#") {
    return root;
  }
  if (!reference.startsWith("#/")) {
    return undefined;
  }
  return reference
    .slice(2)
    .split("/")
    .reduce<unknown>(
      (node, part) => (isRecord(node) ? node[decodePointer(part)] : undefined),
      root,
    );
}

const decodePointer = (part: string): string =>
  part.replaceAll("~1", "/").replaceAll("~0", "~");

/**
 * Paths of object schemas that silently strip or pass through unknown keys.
 * Configuration schemas must be `.strict()` so a misspelled key is an error.
 * Paths read `a.b` for keys, `a[]` for list items and `a{}` for record values.
 */
export function lenientObjectPaths(schema: unknown): string[] {
  if (!isZodSchema(schema)) {
    return [];
  }
  const root = toInputJsonSchema(schema);
  const visit = (
    node: unknown,
    path: string,
    references: readonly string[],
  ): string[] => {
    if (!isRecord(node)) {
      return [];
    }
    if (typeof node.$ref === "string") {
      return references.includes(node.$ref)
        ? []
        : visit(resolveReference(root, node.$ref), path, [
            ...references,
            node.$ref,
          ]);
    }
    const found: string[] = [];
    const extra = node.additionalProperties;
    if (isRecord(node.properties)) {
      const closed =
        extra === false || (isRecord(extra) && Object.keys(extra).length > 0);
      if (!closed) {
        found.push(path || "(root)");
      }
      for (const [key, child] of Object.entries(node.properties)) {
        found.push(...visit(child, path ? `${path}.${key}` : key, references));
      }
    }
    if (isRecord(extra)) {
      found.push(...visit(extra, `${path}{}`, references));
    }
    for (const items of [node.items].flat()) {
      found.push(...visit(items, `${path}[]`, references));
    }
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      for (const option of Array.isArray(node[keyword]) ? node[keyword] : []) {
        found.push(...visit(option, path, references));
      }
    }
    return found;
  };
  return visit(root, "", []);
}

/** The sorted keys of an object schema; none for any other kind of schema. */
export function objectSchemaKeys(schema: unknown): string[] {
  if (!isZodSchema(schema)) {
    return [];
  }
  const { properties } = toInputJsonSchema(schema);
  return isRecord(properties) ? Object.keys(properties).sort() : [];
}
