import { expect, test } from "bun:test";
import {
  runSecretMenu,
  type SecretEntry,
  type SecretStore,
} from "./secretMenu";
import type { SecretTerminal } from "./secretPrompt";

const entries: SecretEntry[] = [
  { name: "TOKEN", kind: "credential", service: "framework" },
  { name: "KEY", kind: "optional", service: "app" },
];

function fakeStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: SecretStore = {
    get: async (service, name) => values.get(`${service}/${name}`) ?? null,
    set: async (service, name, value) => {
      values.set(`${service}/${name}`, value);
    },
    remove: async (service, name) => {
      values.delete(`${service}/${name}`);
    },
  };
  return { store, values };
}

function scripted(choices: (number | null)[], typed: (string | null)[] = []) {
  const titles: string[] = [];
  const shown: string[][] = [];
  const printed: string[] = [];
  const terminal: SecretTerminal = {
    select: async (title, options) => {
      titles.push(title);
      shown.push([...options]);
      return choices.shift() ?? null;
    },
    prompt: async () => typed.shift() ?? null,
    print: (line) => void printed.push(line),
  };
  return { terminal, titles, shown, printed };
}

test("lists every secret with its state and kind", async () => {
  const { store } = fakeStore({ "framework/TOKEN": "x" });
  const { terminal, shown } = scripted([null]);
  await runSecretMenu(entries, store, terminal);
  expect(shown[0]?.[0]).toContain("● defined");
  expect(shown[0]?.[0]).toContain("Cloudflare credential");
  expect(shown[0]?.[1]).toContain("○ not defined");
  expect(shown[0]?.[1]).toContain("optional");
});

test("sets, replaces and removes a secret", async () => {
  const { store, values } = fakeStore();
  const { terminal, printed } = scripted(
    // KEY -> Set value, KEY -> Replace value, KEY -> Remove -> Yes, Exit
    [1, 0, 1, 0, 1, 1, 1, 1, null],
    ["first", "second"],
  );
  await runSecretMenu(entries, store, terminal);
  expect(printed).toEqual(["KEY: saved", "KEY: saved", "KEY: removed"]);
  expect(values.has("app/KEY")).toBe(false);
});

test("keeps the secret when removal is declined or input is cancelled", async () => {
  const { store, values } = fakeStore({ "app/KEY": "keep" });
  const { terminal } = scripted([1, 1, 0, 1, 0, null, null], [null]);
  await runSecretMenu(entries, store, terminal);
  expect(values.get("app/KEY")).toBe("keep");
});

test("rejects empty values", async () => {
  const { store, values } = fakeStore();
  const { terminal, printed } = scripted([1, 0, null], [""]);
  await runSecretMenu(entries, store, terminal);
  expect(values.size).toBe(0);
  expect(printed[0]).toContain("nothing changed");
});
