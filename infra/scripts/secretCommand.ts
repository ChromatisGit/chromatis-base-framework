import {
  runSecretMenu,
  type SecretEntry,
  type SecretKind,
} from "./secretMenu.js";
import type { DeclaredSecret, SecretRequirement } from "./moduleSet.js";
import type { ConfigEnvironment } from "../../src/config.js";
import { createSecretTerminal } from "./secretPrompt.js";

interface SecretApplication {
  name: string;
  environment: ConfigEnvironment;
  declaredSecrets: readonly DeclaredSecret[];
}

const KIND: Record<SecretRequirement, SecretKind> = {
  always: "required",
  production: "production",
};

interface SecretServices {
  credentialNames: readonly string[];
  credentialService: string;
  applicationService: (name: string, environment: ConfigEnvironment) => string;
}

/** Every secret the menu manages: Cloudflare credentials, then the declared secrets. */
export function secretEntries(
  app: SecretApplication,
  services: SecretServices,
): SecretEntry[] {
  const applicationService = services.applicationService(
    app.name,
    app.environment,
  );
  return [
    ...services.credentialNames.map((name): SecretEntry => ({
      name,
      kind: "credential",
      service: services.credentialService,
    })),
    ...app.declaredSecrets.map((secret): SecretEntry => ({
      name: secret.name,
      kind: KIND[secret.requirement],
      service: applicationService,
    })),
  ];
}

/** `chromatis secret`: an interactive menu; values never travel as arguments. */
export async function secretCommand(
  args: readonly string[],
  app: SecretApplication,
  services: SecretServices,
): Promise<void> {
  // `--env <name>` picks the store; `commandEnvironment` has already read it.
  const rest = args.filter(
    (arg, index) =>
      !(
        arg === "--env" ||
        arg.startsWith("--env=") ||
        args[index - 1] === "--env"
      ),
  );
  if (rest.length > 0) {
    throw new Error(
      "chromatis secret takes only --env; values are only entered in the menu so they never reach shell history",
    );
  }
  await runSecretMenu(
    secretEntries(app, services),
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
