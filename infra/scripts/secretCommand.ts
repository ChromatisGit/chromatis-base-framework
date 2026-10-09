import {
  runSecretMenu,
  type SecretEntry,
  type SecretKind,
} from "./secretMenu.js";
import { createSecretTerminal } from "./secretPrompt.js";

interface SecretApplication {
  name: string;
  postgresql: boolean;
  secrets: readonly string[];
  optionalSecrets: readonly string[];
}

interface SecretServices {
  credentialNames: readonly string[];
  credentialService: string;
  applicationService: (name: string) => string;
}

/** `bun run secret`: an interactive menu; values never travel as arguments. */
export async function secretCommand(
  args: readonly string[],
  app: SecretApplication,
  services: SecretServices,
): Promise<void> {
  if (args.length > 0) {
    throw new Error(
      "bun run secret takes no arguments; values are only entered in the menu so they never reach shell history",
    );
  }
  const applicationService = services.applicationService(app.name);
  const entry = (
    name: string,
    kind: SecretKind,
    service: string,
  ): SecretEntry => ({ name, kind, service });
  const database = app.postgresql
    ? ["DATABASE_URL", "DATABASE_MIGRATION_URL"]
    : [];
  const entries = [
    ...services.credentialNames.map((name) =>
      entry(name, "credential", services.credentialService),
    ),
    ...[...app.secrets, ...database].map((name) =>
      entry(name, "required", applicationService),
    ),
    ...app.optionalSecrets.map((name) =>
      entry(name, "optional", applicationService),
    ),
  ];
  await runSecretMenu(
    entries,
    {
      get: (service, name) => Bun.secrets.get({ service, name }),
      set: (service, name, value) => Bun.secrets.set({ service, name, value }),
      remove: async (service, name) => {
        await Bun.secrets.delete({ service, name });
      },
    },
    createSecretTerminal(),
  );
}
