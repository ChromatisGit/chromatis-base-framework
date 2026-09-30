import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { pathToFileURL } from "node:url";
import type { SecretDefinition } from "../../src/secrets.js";

type Target = "local" | "production";

interface SecretStore {
  configured(names: readonly string[]): Promise<ReadonlySet<string>>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

function findSecretFiles(): string[] {
  const files: string[] = [];
  const appSecrets = path.resolve("src/app/config/secrets.ts");
  if (existsSync(appSecrets)) {
    files.push(appSecrets);
  }
  const modules = path.resolve("src/modules");
  if (existsSync(modules)) {
    for (const moduleName of readdirSync(modules)) {
      const secretFile = path.join(modules, moduleName, "secrets.ts");
      if (existsSync(secretFile)) {
        files.push(secretFile);
      }
    }
  }
  return files.sort();
}

function isSecretDefinition(value: unknown): value is SecretDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SecretDefinition>;
  return (
    typeof candidate.name === "string" &&
    /^[A-Z][A-Z0-9_]*$/.test(candidate.name) &&
    typeof candidate.owner === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.required === "boolean" &&
    typeof candidate.schema?.safeParse === "function"
  );
}

async function declaredSecrets(): Promise<readonly SecretDefinition[]> {
  const definitions: SecretDefinition[] = [];
  for (const file of findSecretFiles()) {
    const module = (await import(pathToFileURL(file).href)) as Record<
      string,
      unknown
    >;
    for (const value of Object.values(module)) {
      if (isSecretDefinition(value)) {
        definitions.push(value);
      }
    }
  }
  if (definitions.length === 0) {
    throw new Error(
      "No secret declarations found in src/app/config/secrets.ts or src/modules/*/secrets.ts",
    );
  }
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) {
      throw new Error(`Secret ${definition.name} is declared more than once`);
    }
    names.add(definition.name);
  }
  return definitions.sort((left, right) => left.name.localeCompare(right.name));
}

function projectService(): string {
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      name?: unknown;
    };
    if (typeof manifest.name === "string" && manifest.name.trim()) {
      return `dev.chromatis.${manifest.name.replace(/[^A-Za-z0-9.-]/g, ".")}`;
    }
  } catch {
    // Falling back to the project directory keeps local storage available.
  }
  return `dev.chromatis.${path.basename(process.cwd())}`;
}

class LocalSecretStore implements SecretStore {
  constructor(private readonly service: string) {}

  async configured(names: readonly string[]): Promise<ReadonlySet<string>> {
    const configured = new Set<string>();
    for (const name of names) {
      if ((await Bun.secrets.get({ service: this.service, name })) !== null) {
        configured.add(name);
      }
    }
    return configured;
  }

  async set(name: string, value: string): Promise<void> {
    await Bun.secrets.set({ service: this.service, name, value });
  }

  async delete(name: string): Promise<void> {
    await Bun.secrets.delete({ service: this.service, name });
  }
}

class CloudflareSecretStore implements SecretStore {
  private run(args: readonly string[], input?: string): string {
    const result = spawnSync("bun", ["x", "wrangler", ...args], {
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
    });
    if (result.status !== 0) {
      throw new Error("Wrangler secret operation failed");
    }
    return result.stdout;
  }

  async configured(): Promise<ReadonlySet<string>> {
    const listed = JSON.parse(this.run(["secret", "list"]) || "[]") as Array<{
      name?: unknown;
    }>;
    return new Set(
      listed.flatMap(({ name }) => (typeof name === "string" ? [name] : [])),
    );
  }

  async set(name: string, value: string): Promise<void> {
    this.run(["secret", "put", name], `${value}\n`);
  }

  async delete(name: string): Promise<void> {
    this.run(["secret", "delete", name], "y\n");
  }
}

function storeFor(target: Target): SecretStore {
  return target === "local"
    ? new LocalSecretStore(projectService())
    : new CloudflareSecretStore();
}

function requireTerminal(): void {
  if (
    !process.stdin.isTTY ||
    !process.stdin.setRawMode ||
    !process.stdout.isTTY
  ) {
    throw new Error("Secret management requires an interactive terminal");
  }
}

async function select<T>(
  question: string,
  options: readonly T[],
  label: (item: T) => string,
): Promise<T> {
  requireTerminal();
  let selected = 0;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const render = (first: boolean) => {
    if (!first) {
      process.stdout.write(`\u001b[${options.length + 1}A`);
    }
    process.stdout.write(`? ${question}\u001b[K\n`);
    options.forEach((option, index) => {
      process.stdout.write(
        `${index === selected ? ">" : " "} ${label(option)}\u001b[K\n`,
      );
    });
  };
  render(true);
  return await new Promise<T>((resolve, reject) => {
    const finish = (error?: Error) => {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (error) {
        reject(error);
      } else {
        resolve(options[selected]!);
      }
    };
    const keypress = (
      _text: string,
      key: { name?: string; ctrl?: boolean },
    ) => {
      if (key.ctrl && key.name === "c") {
        return finish(new Error("cancelled"));
      }
      if (key.name === "return" || key.name === "enter") {
        return finish();
      }
      if (key.name === "up" || key.name === "down") {
        selected =
          (selected + (key.name === "up" ? -1 : 1) + options.length) %
          options.length;
        render(false);
      }
    };
    process.stdin.on("keypress", keypress);
  });
}

async function hiddenValue(): Promise<string> {
  requireTerminal();
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\nSecret value: ");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const keypress = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        return finish(new Error("cancelled"));
      }
      if (key.name === "return" || key.name === "enter") {
        return finish();
      }
      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (!key.ctrl && text >= " " && text !== "\u007f") {
        value += text;
        process.stdout.write("*".repeat([...text].length));
      }
    };
    process.stdin.on("keypress", keypress);
  });
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  if (
    !(action === "set" || action === "status" || action === "delete") ||
    rest.length > 0
  ) {
    throw new Error("usage: bun run secret <set | status | delete>");
  }
  const target = await select<Target>(
    "Target",
    ["local", "production"],
    (item) => (item === "local" ? "Local" : "Production"),
  );
  const definitions = await declaredSecrets();
  const store = storeFor(target);
  if (action === "status") {
    const configured = await store.configured(
      definitions.map(({ name }) => name),
    );
    for (const { name } of definitions) {
      console.info(
        `${name}: ${configured.has(name) ? "configured" : "missing"}`,
      );
    }
    return;
  }
  const definition = await select(
    "Select secret",
    definitions,
    ({ name }) => name,
  );
  if (action === "delete") {
    await store.delete(definition.name);
    console.info(`${definition.name}: deleted`);
    return;
  }
  const value = await hiddenValue();
  if (value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error("Secret value must be non-empty and single-line");
  }
  if (!definition.schema.safeParse(value).success) {
    throw new Error(`Invalid value for ${definition.name}`);
  }
  await store.set(definition.name, value);
  console.info(`${definition.name}: configured`);
}

main().catch((error: unknown) => {
  console.error(
    `[secret] ${error instanceof Error ? error.message : "operation failed"}`,
  );
  process.exitCode = 1;
});
