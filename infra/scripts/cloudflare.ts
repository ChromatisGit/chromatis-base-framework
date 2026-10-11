import { existsSync } from "node:fs";
import path from "node:path";
import { promptSecret } from "./secretPrompt.js";
import {
  credentialNames,
  credentialService,
  defaultSecretLookup,
  type SecretLookup,
} from "./secretStore.js";

/** Cloudflare API access for deployment checks and smoke tests. */

/** Wrangler's entry, found in the nearest `node_modules` (hoisted in a monorepo). */
export function findWrangler(root: string): string {
  const relative = "node_modules/wrangler/bin/wrangler.js";
  for (let directory = root; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (path.dirname(directory) === directory) {
      return path.join(root, relative);
    }
  }
}

export async function workerDevUrl(
  appName: string,
  values: Record<string, string>,
): Promise<string> {
  const accountId = encodeURIComponent(values.CLOUDFLARE_ACCOUNT_ID ?? "");
  const headers = {
    Authorization: `Bearer ${values.CLOUDFLARE_API_TOKEN}`,
  };
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const [accountResponse, workerResponse] = await Promise.all([
    fetch(`${base}/subdomain`, { headers }),
    fetch(`${base}/scripts/${encodeURIComponent(appName)}/subdomain`, {
      headers,
    }),
  ]);
  if (!accountResponse.ok || !workerResponse.ok) {
    throw new Error(
      `Cloudflare could not provide the workers.dev URL (account: HTTP ${accountResponse.status}, Worker: HTTP ${workerResponse.status})`,
    );
  }
  const account = (await accountResponse.json()) as {
    success?: boolean;
    result?: { subdomain?: string };
  };
  const worker = (await workerResponse.json()) as {
    success?: boolean;
    result?: { enabled?: boolean };
  };
  if (!account.success || !account.result?.subdomain) {
    throw new Error("Cloudflare account has no workers.dev subdomain");
  }
  if (!worker.success || !worker.result?.enabled) {
    throw new Error(`Worker ${appName} is not enabled on workers.dev`);
  }
  return `https://${appName}.${account.result.subdomain}.workers.dev`;
}

export function cloudflareEnvironment(
  values: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID,
  };
}

export async function checkCloudflare(
  values: Record<string, string>,
): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(values.CLOUDFLARE_ACCOUNT_ID ?? "")}/workers/scripts`,
    {
      headers: { Authorization: `Bearer ${values.CLOUDFLARE_API_TOKEN}` },
    },
  );
  if (!response.ok) {
    throw new Error(
      "Cloudflare credentials or account failed validation; run chromatis secret to define CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
    );
  }
}

/**
 * Cloudflare API credentials from the environment or the credential store.
 * With `prompt`, missing ones are asked for (hidden input) and stored.
 */
export async function cloudflareCredentials(
  prompt: boolean,
  lookup: SecretLookup = defaultSecretLookup,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of credentialNames) {
    let value = await lookup(credentialService, name);
    if (!value && prompt) {
      value = await promptSecret(name);
      if (!value || /[\r\n]/.test(value)) {
        throw new Error(`Invalid ${name}`);
      }
      await Bun.secrets.set({ service: credentialService, name, value });
    }
    if (!value) {
      throw new Error(`${name} missing; run chromatis secret`);
    }
    result[name] = value;
  }
  return result;
}
