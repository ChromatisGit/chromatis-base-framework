import { describe, expect, test } from "bun:test";
import Ajv from "ajv";
import { parse, stringify } from "smol-toml";
import { CONFIG_ENVIRONMENTS, parseConfigResult, z } from "../../src/config.js";
import { appConfigSchema } from "./appConfig.js";
import {
  authoredFileJsonSchema,
  layeredConfigSchema,
} from "./editorSchemas.js";

type Json = Record<string, unknown>;
const isTable = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// --- The layered schema agrees with the real merge ------------------------

const richSchema = z
  .object({
    name: z.string().min(1),
    mode: z.enum(["quiet", "loud"]).default("quiet"),
    limits: z
      .object({
        max: z.number().int().min(1),
        burst: z.number().min(0).optional(),
      })
      .strict(),
    servers: z.record(
      z.string(),
      z
        .object({ host: z.string(), port: z.number().int().default(80) })
        .strict(),
    ),
    rules: z
      .array(z.object({ id: z.string(), weight: z.number() }).strict())
      .default([]),
    tags: z.array(z.string()).default([]),
    nested: z
      .object({ deep: z.object({ flag: z.boolean() }).strict() })
      .strict()
      .optional(),
  })
  .strict();

const richValue = {
  name: "demo",
  mode: "loud",
  limits: { max: 5, burst: 2 },
  servers: { a: { host: "a.example", port: 81 }, b: { host: "b.example" } },
  rules: [
    { id: "x", weight: 1 },
    { id: "y", weight: 2 },
  ],
  tags: ["one", "two"],
  nested: { deep: { flag: true } },
};

const appValue = {
  deployment: {
    target: "bun",
    domain: "example.org",
    name: "demo",
    port: 8080,
  },
  modules: { disabled: ["classroom"] },
  routes: { omit: ["/legal"] },
};

const FIXTURES = [
  { name: "app config", schema: appConfigSchema, value: appValue },
  {
    name: "nested tables, records and lists",
    schema: richSchema,
    value: richValue,
  },
] as const;

/** mulberry32: a small seeded generator so a failing case can be replayed. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYERS = ["base", "default", ...CONFIG_ENVIRONMENTS] as const;

/** Scatters the leaves of a valid value (tables recursed, lists whole) over the layers. */
function scatter(value: Json, random: () => number): Record<string, Json> {
  const layers: Record<string, Json> = Object.fromEntries(
    LAYERS.map((name) => [name, {}]),
  );
  const place = (source: Json, trail: string[]): void => {
    for (const [key, child] of Object.entries(source)) {
      if (isTable(child) && Object.keys(child).length > 0) {
        place(child, [...trail, key]);
        continue;
      }
      const layer = layers[LAYERS[Math.floor(random() * LAYERS.length)]!]!;
      let table = layer;
      for (const step of trail) {
        table = (table[step] ??= {}) as Json;
      }
      table[key] = structuredClone(child);
    }
  };
  place(value, []);
  return layers;
}

type Slot = { table: Json; key: string };

function slotsOf(table: Json, found: Slot[] = []): Slot[] {
  for (const key of Object.keys(table)) {
    found.push({ table, key });
    const child = table[key];
    if (isTable(child)) {
      slotsOf(child, found);
    }
  }
  return found;
}

/** One random edit that usually (not always) makes the file invalid. */
function mutate(layers: Record<string, Json>, random: () => number): void {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const tables: Json[] = [];
  const collect = (table: Json): void => {
    tables.push(table);
    Object.values(table).filter(isTable).forEach(collect);
  };
  Object.values(layers).forEach(collect);
  const slots = Object.values(layers).flatMap((layer) => slotsOf(layer));
  const slot = slots.length > 0 ? pick(slots) : undefined;
  switch (Math.floor(random() * 7)) {
    case 0:
      pick(tables)["zzz"] = 1;
      break;
    case 1:
      if (slot) {
        slot.table[slot.key] = 7;
      }
      break;
    case 2:
      if (slot) {
        slot.table[slot.key] = "not a number";
      }
      break;
    case 3:
      if (slot) {
        slot.table[slot.key] = -5;
      }
      break;
    case 4:
      if (slot) {
        slot.table[slot.key] = ["x", "y"];
      }
      break;
    case 5: {
      const lists = slots.filter(({ table, key }) => Array.isArray(table[key]));
      const list = lists.length > 0 ? pick(lists) : undefined;
      const first = list ? (list.table[list.key] as unknown[])[0] : undefined;
      if (isTable(first)) {
        if (random() < 0.5) {
          delete first[Object.keys(first)[0]!];
        } else {
          first["zzz"] = true;
        }
      }
      break;
    }
    default:
      if (slot) {
        slot.table[slot.key] = "bogus";
      }
  }
}

const withoutEmptyTables = (table: Json): Json =>
  Object.fromEntries(
    Object.entries(table)
      .map(([key, value]): [string, unknown] => [
        key,
        isTable(value) ? withoutEmptyTables(value) : value,
      ])
      .filter(
        ([, value]) => !(isTable(value) && Object.keys(value).length === 0),
      ),
  );

function toToml(layers: Record<string, Json>): string {
  const { base, ...tables } = layers;
  return stringify(withoutEmptyTables({ ...base, ...tables }));
}

/**
 * A layer is a valid partial overlay when, merged alone, the real parser
 * finds nothing wrong except values nobody set: `Required` outside lists is
 * the post-merge check of `chromatis check`, while list items replace as a
 * whole and so must be complete in every layer.
 */
function isValidOverlay(
  document: Json,
  environment: (typeof CONFIG_ENVIRONMENTS)[number],
  schema: z.ZodType,
): boolean {
  const result = parseConfigResult(
    stringify(withoutEmptyTables(document)),
    environment,
    schema,
  );
  return (
    result.ok ||
    (result.syntaxError === undefined &&
      result.issues.every(
        (issue) =>
          issue.message === "Required" &&
          !issue.key.split(".").some((step) => /^\d+$/.test(step)),
      ))
  );
}

function acceptedAsOverlays(
  layers: Record<string, Json>,
  schema: z.ZodType,
): boolean {
  return (
    isValidOverlay(layers["base"]!, "local", schema) &&
    isValidOverlay({ default: layers["default"] }, "local", schema) &&
    CONFIG_ENVIRONMENTS.every((environment) =>
      isValidOverlay(
        { [environment]: layers[environment] },
        environment,
        schema,
      ),
    )
  );
}

describe("layered config schema", () => {
  for (const { name, schema, value } of FIXTURES) {
    test(`accepts exactly the files whose layers are valid overlays: ${name}`, () => {
      const validate = new Ajv({ strict: false }).compile(
        layeredConfigSchema(schema, "config/x.toml"),
      );
      const random = generator(20_251_010);
      let valid = 0;
      let invalid = 0;
      for (let round = 0; round < 400; round++) {
        const layers = scatter(value as Json, random);
        for (let edits = Math.floor(random() * 3); edits > 0; edits--) {
          mutate(layers, random);
        }
        const text = toToml(layers);
        const expected = acceptedAsOverlays(layers, schema);
        const actual = validate(parse(text));
        if (actual !== expected) {
          throw new Error(
            `round ${round}: merge ${expected ? "accepts" : "rejects"} but the schema ${actual ? "accepts" : "rejects"}:\n${text}\n${JSON.stringify(validate.errors)}`,
          );
        }
        if (expected) {
          valid++;
        } else {
          invalid++;
        }
      }
      // Both outcomes must actually be exercised.
      expect(valid).toBeGreaterThan(40);
      expect(invalid).toBeGreaterThan(40);
    });
  }

  test("a layer is a partial overlay but list items stay complete", () => {
    const json = layeredConfigSchema(richSchema, "config/x.toml") as {
      properties: Record<string, { $ref?: string }>;
      definitions: { layer: Json };
    };
    const layer = json.definitions.layer as {
      required?: unknown;
      properties: { limits: { required?: unknown }; rules: { items: Json } };
    };
    expect(layer.required).toBeUndefined();
    expect(layer.properties.limits.required).toBeUndefined();
    expect(layer.properties.rules.items["required"]).toEqual(["id", "weight"]);
    expect(Object.keys(json.properties)).toEqual(
      expect.arrayContaining([
        "name",
        "default",
        "local",
        "test",
        "production",
      ]),
    );
    expect(json.properties["production"]?.$ref).toBe("#/definitions/layer");
  });

  test("keys the merge treats as environment tables cannot be schema keys", () => {
    expect(() =>
      layeredConfigSchema(z.object({ test: z.string() }).strict(), "x"),
    ).toThrow(/reserved/);
  });

  test("checks JSON Schema cannot express are left to Zod", () => {
    const schema = z
      .object({ a: z.number() })
      .strict()
      .superRefine(() => {});
    const json = layeredConfigSchema(schema, "x") as { properties: Json };
    expect(json.properties["a"]).toEqual({ type: "number" });
  });

  test("authored files use the schema as written, without layers", () => {
    const json = authoredFileJsonSchema(
      z.object({ titel: z.string() }).strict(),
      "course",
    );
    expect(json).toMatchObject({
      title: "course",
      required: ["titel"],
      additionalProperties: false,
    });
    expect(json["definitions"]).toBeUndefined();
  });
});
