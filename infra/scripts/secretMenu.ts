import type { SecretTerminal } from "./secretPrompt.js";

export type SecretKind = "credential" | "required" | "optional";

export interface SecretEntry {
  name: string;
  kind: SecretKind;
  service: string;
}

export interface SecretStore {
  get(service: string, name: string): Promise<string | null>;
  set(service: string, name: string, value: string): Promise<void>;
  remove(service: string, name: string): Promise<void>;
}

const KIND_LABEL: Record<SecretKind, string> = {
  credential: "Cloudflare credential",
  required: "required",
  optional: "optional",
};

function describe(entry: SecretEntry, configured: boolean): string {
  const state = configured ? "● defined" : "○ not defined";
  return `${entry.name.padEnd(26)} ${state.padEnd(15)} ${KIND_LABEL[entry.kind]}`;
}

async function setValue(
  entry: SecretEntry,
  store: SecretStore,
  terminal: SecretTerminal,
): Promise<void> {
  const value = await terminal.prompt(entry.name);
  if (value === null) {
    return;
  }
  if (!value || /[\r\n]/.test(value)) {
    terminal.print("Secret must be nonempty and single line; nothing changed.");
    return;
  }
  await store.set(entry.service, entry.name, value);
  terminal.print(`${entry.name}: saved`);
}

async function removeValue(
  entry: SecretEntry,
  store: SecretStore,
  terminal: SecretTerminal,
): Promise<void> {
  const answer = await terminal.select(`Remove ${entry.name}?`, [
    "No, keep it",
    "Yes, remove it",
  ]);
  if (answer === 1) {
    await store.remove(entry.service, entry.name);
    terminal.print(`${entry.name}: removed`);
  }
}

async function manage(
  entry: SecretEntry,
  configured: boolean,
  store: SecretStore,
  terminal: SecretTerminal,
): Promise<void> {
  const actions = configured
    ? ["Replace value", "Remove", "Back"]
    : ["Set value", "Back"];
  const choice = await terminal.select(entry.name, actions);
  if (choice === 0) {
    await setValue(entry, store, terminal);
  } else if (choice === 1 && configured) {
    await removeValue(entry, store, terminal);
  }
}

/** Interactive overview of every secret the application defines. */
export async function runSecretMenu(
  entries: readonly SecretEntry[],
  store: SecretStore,
  terminal: SecretTerminal,
): Promise<void> {
  for (;;) {
    const configured = await Promise.all(
      entries.map(
        async (entry) => !!(await store.get(entry.service, entry.name)),
      ),
    );
    const choice = await terminal.select("Secrets", [
      ...entries.map((entry, index) =>
        describe(entry, configured[index] ?? false),
      ),
      "Exit",
    ]);
    const entry = choice === null ? undefined : entries[choice];
    if (!entry) {
      return;
    }
    await manage(entry, configured[choice as number] ?? false, store, terminal);
  }
}
