import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyDirectives,
  directiveFor,
  editorSchemaProblems,
  planEditorSchemas,
  readDirective,
  syncEditorSchemas,
  withDirective,
  writeEditorSchemas,
} from "./editorSchemas.js";
import { loadInstance } from "./instance.js";
import { checkInstance } from "./instanceCheck.js";
import { fixInstance } from "./instanceFix.js";
import {
  APP_TOML,
  cleanupFixtures,
  createInstance,
  type FixtureModule,
} from "./instanceFixture.js";
import { formatProblem } from "./problems.js";

afterEach(cleanupFixtures);

// --- The editor line ------------------------------------------------------

describe("editor schema line", () => {
  test("is relative to the file, in either direction", () => {
    expect(directiveFor("config/app.toml", "app.schema.json")).toBe(
      "#:schema ../.chromatis/schemas/app.schema.json",
    );
    expect(directiveFor("content/kurse/a.toml", "x.course.schema.json")).toBe(
      "#:schema ../../.chromatis/schemas/x.course.schema.json",
    );
    expect(directiveFor("root.toml", "x.schema.json")).toBe(
      "#:schema ./.chromatis/schemas/x.schema.json",
    );
  });

  test("is added first, replaced in place, and found among leading comments", () => {
    const line = "#:schema ../.chromatis/schemas/a.schema.json";
    expect(withDirective("[a]\n", line)).toBe(`${line}\n[a]\n`);
    expect(withDirective("# Why\n[a]\n", line)).toBe(`${line}\n# Why\n[a]\n`);
    expect(withDirective("#:schema ./old.json\n[a]\n", line)).toBe(
      `${line}\n[a]\n`,
    );
    expect(withDirective("# Why\n#:schema ./old.json\n\n[a]\n", line)).toBe(
      `# Why\n${line}\n\n[a]\n`,
    );
    // A later comment is not a directive: the first key ends the header.
    expect(withDirective("a = 1\n#:schema ./old.json\n", line)).toBe(
      `${line}\na = 1\n#:schema ./old.json\n`,
    );
    expect(readDirective(`# Why\n${line}\n[a]\n`)).toBe(line);
    expect(readDirective("[a]\n")).toBeUndefined();
    expect(withDirective(withDirective("[a]\n", line), line)).toBe(
      `${line}\n[a]\n`,
    );
  });
});

// --- Plan, init, fix, check -----------------------------------------------

const notes: FixtureModule = {
  body: `
    config: { schema: z.object({ folder: z.string().default("notes") }).strict() },
    authoredFiles: [{ module: "../modules/notes/authored.ts" }],
  `,
  files: {
    "authored.ts": `
      import { z } from ${JSON.stringify(path.resolve(import.meta.dir, "../../src/module.ts"))};
      export default function (context: { config: Record<string, any> }) {
        const folder = context.config.notes.folder;
        return [
          { name: "special", include: folder + "/special-*.toml", schema: z.object({ title: z.string().min(1), star: z.boolean() }).strict() },
          { name: "note", include: [folder + "/*.toml"], schema: z.object({ title: z.string().min(1) }).strict() },
        ];
      }
    `,
  },
};

async function notesInstance(editor = true) {
  const { root } = await createInstance({
    modules: { notes },
    config: { "app.toml": APP_TOML },
    files: {
      "notes/special-1.toml": 'title = "one"\nstar = true\n',
      "notes/plain.toml": 'title = "plain"\n',
      "notes/readme.md": "not toml",
      "other/ignored.toml": "x = 1\n",
    },
    editor,
  });
  return root;
}

describe("planEditorSchemas", () => {
  test("derives schemas and associations from the config slots and authored files", async () => {
    const root = await notesInstance(false);
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    expect(plan.problems).toEqual([]);
    expect(plan.schemas.map((schema) => schema.file)).toEqual([
      "app.schema.json",
      "notes.note.schema.json",
      "notes.schema.json",
      "notes.special.schema.json",
    ]);
    expect(plan.associations).toEqual([
      { file: "config/app.toml", schema: "app.schema.json" },
      { file: "notes/plain.toml", schema: "notes.note.schema.json" },
      // The first matching association of a module wins.
      { file: "notes/special-1.toml", schema: "notes.special.schema.json" },
    ]);
  });

  test("the module's own config decides the paths", async () => {
    const root = await notesInstance(false);
    writeFileSync(
      path.join(root, "config/notes.toml"),
      '[default]\nfolder = "other"\n',
    );
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    expect(plan.associations.map(({ file }) => file)).toEqual([
      "config/app.toml",
      "config/notes.toml",
      "other/ignored.toml",
    ]);
  });

  test("a module with invalid config contributes no authored files and no extra noise", async () => {
    const root = await notesInstance(false);
    writeFileSync(
      path.join(root, "config/notes.toml"),
      "[default]\nfolder = 3\n",
    );
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    expect(plan.problems).toEqual([]);
    expect(plan.associations.map(({ file }) => file)).toEqual([
      "config/app.toml",
      "config/notes.toml",
    ]);
  });

  test("reports an authored-files function that fails or returns nonsense", async () => {
    const broken: FixtureModule = {
      body: `authoredFiles: [{ module: "../modules/broken/a.ts" }, { module: "../modules/broken/b.ts" }]`,
      files: {
        "a.ts": 'export default () => { throw new Error("no luck"); };',
        "b.ts":
          'export default () => [{ name: "Bad Name", include: "../x/*.toml", schema: {} }];',
      },
    };
    const { root } = await createInstance({
      modules: { broken },
      config: { "app.toml": APP_TOML },
      editor: false,
    });
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    expect(plan.problems.map(formatProblem)).toEqual([
      "broken authored files: ../modules/broken/a.ts: failed: no luck",
      expect.stringContaining(
        "broken authored files: ../modules/broken/b.ts: failed:",
      ),
    ]);
    expect(plan.problems[1]?.message).toContain("lowercase letters");
    expect(plan.problems[1]?.message).toContain("must be a zod schema");
  });

  test("one file cannot follow two modules' schemas", async () => {
    const other: FixtureModule = {
      body: `authoredFiles: [{ module: "../modules/other/authored.ts" }]`,
      files: {
        "authored.ts": `
          import { z } from ${JSON.stringify(path.resolve(import.meta.dir, "../../src/module.ts"))};
          export default () => [{ name: "any", include: "notes/*.toml", schema: z.object({}).strict() }];
        `,
      },
    };
    const { root } = await createInstance({
      modules: { notes, other },
      config: { "app.toml": APP_TOML },
      files: { "notes/plain.toml": 'title = "plain"\n' },
      editor: false,
    });
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    expect(plan.problems.map(formatProblem)).toEqual([
      "other authored files: notes/plain.toml: already follows notes.note.schema.json (notes); one file cannot follow two schemas",
    ]);
    expect(
      plan.associations.find(({ file }) => file === "notes/plain.toml")?.schema,
    ).toBe("notes.note.schema.json");
  });
});

describe("init, check and fix", () => {
  test("init writes the schemas under .chromatis and nothing else", async () => {
    const root = await notesInstance(false);
    const plan = await syncEditorSchemas(root);
    expect(plan.problems).toEqual([]);
    expect(
      JSON.parse(
        readFileSync(
          path.join(root, ".chromatis/schemas/notes.note.schema.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ title: "notes: note", required: ["title"] });
    // The author's files are untouched until `fix`.
    expect(readFileSync(path.join(root, "notes/plain.toml"), "utf8")).toBe(
      'title = "plain"\n',
    );
    expect(existsSync(path.join(root, ".taplo.toml"))).toBe(false);
  });

  test("a schema nothing needs any more is removed", async () => {
    const root = await notesInstance(false);
    await syncEditorSchemas(root);
    const stale = path.join(root, ".chromatis/schemas/gone.schema.json");
    writeFileSync(stale, "{}");
    mkdirSync(path.join(root, ".chromatis/schemas/keep"), { recursive: true });
    writeEditorSchemas(
      root,
      await planEditorSchemas(await loadInstance(root, "local")),
    );
    expect(existsSync(stale)).toBe(false);
  });

  test("check names missing, wrong and stale editor support; fix repairs the lines", async () => {
    const root = await notesInstance(false);
    const before = (await checkInstance(root, { scripts: false })).map(
      formatProblem,
    );
    expect(before).toContain(
      ".chromatis/schemas/notes.note.schema.json: differs from the framework output; run chromatis init",
    );
    expect(before).toContain(
      'notes/plain.toml: missing the editor schema line "#:schema ../.chromatis/schemas/notes.note.schema.json"; run chromatis fix',
    );

    const result = await fixInstance(root, () => undefined);
    expect(result.annotated).toEqual([
      "config/app.toml",
      "notes/plain.toml",
      "notes/special-1.toml",
    ]);
    expect(result.remaining).toEqual([]);
    expect(readFileSync(path.join(root, "notes/plain.toml"), "utf8")).toBe(
      '#:schema ../.chromatis/schemas/notes.note.schema.json\ntitle = "plain"\n',
    );
    expect(
      readFileSync(path.join(root, "notes/special-1.toml"), "utf8"),
    ).toStartWith("#:schema ../.chromatis/schemas/notes.special.schema.json\n");

    writeFileSync(
      path.join(root, "notes/plain.toml"),
      '#:schema ./wrong.json\ntitle = "plain"\n',
    );
    const wrong = await checkInstance(root, { scripts: false });
    expect(wrong.map(formatProblem)).toEqual([
      'notes/plain.toml: editor schema line is "#:schema ./wrong.json", expected "#:schema ../.chromatis/schemas/notes.note.schema.json"; run chromatis fix',
    ]);
    expect((await fixInstance(root, () => undefined)).annotated).toEqual([
      "notes/plain.toml",
    ]);
    expect(await checkInstance(root, { scripts: false })).toEqual([]);
  });

  test("a new hand-written file is reported until fix annotates it", async () => {
    const root = await notesInstance();
    expect(await checkInstance(root, { scripts: false })).toEqual([]);
    writeFileSync(path.join(root, "notes/new.toml"), 'title = "new"\n');
    expect(
      (await checkInstance(root, { scripts: false })).map(formatProblem),
    ).toEqual([
      'notes/new.toml: missing the editor schema line "#:schema ../.chromatis/schemas/notes.note.schema.json"; run chromatis fix',
    ]);
  });

  test("applyDirectives is idempotent", async () => {
    const root = await notesInstance(false);
    const plan = await planEditorSchemas(await loadInstance(root, "local"));
    writeEditorSchemas(root, plan);
    expect(applyDirectives(root, plan)).toHaveLength(3);
    expect(applyDirectives(root, plan)).toEqual([]);
    expect(editorSchemaProblems(root, plan)).toEqual([]);
  });
});
