import { beforeAll, expect, test } from "bun:test";
import {
  createOidcProvider,
  OidcAuthenticationError,
  type OidcAuthorizationAttempt,
  type OidcAuthorizationAttemptStore,
} from "./oidc.js";

const nowSeconds = 1_800_000_000;
const configuration = {
  providerId: "school-oidc",
  issuer: "https://identity.example",
  authorizationEndpoint: "https://identity.example/authorize",
  tokenEndpoint: "https://identity.example/token",
  jwksUri: "https://identity.example/.well-known/jwks.json",
  clientId: "client",
  clientSecret: "client-secret",
  redirectUri: "https://app.example/callback",
  scopes: ["openid", "email", "profile"],
  authorizationAttemptTtlSeconds: 300,
} as const;

class MemoryAttemptStore implements OidcAuthorizationAttemptStore {
  readonly attempts = new Map<string, OidcAuthorizationAttempt>();

  async save(attempt: OidcAuthorizationAttempt): Promise<void> {
    this.attempts.set(`${attempt.providerId}:${attempt.stateHash}`, attempt);
  }

  async consume(
    providerId: string,
    stateHash: string,
  ): Promise<OidcAuthorizationAttempt | null> {
    const key = `${providerId}:${stateHash}`;
    const attempt = this.attempts.get(key) ?? null;
    this.attempts.delete(key);
    return attempt;
  }
}

let signingKeys: CryptoKeyPair;
let signingJwk: JsonWebKey;
let otherSigningKeys: CryptoKeyPair;

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  otherSigningKeys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  signingJwk = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);
});

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function signIdToken(
  claims: Readonly<Record<string, unknown>>,
  privateKey = signingKeys.privateKey,
): Promise<string> {
  const encodedHeader = base64Url(
    JSON.stringify({ alg: "RS256", kid: "signing-key", typ: "JWT" }),
  );
  const encodedPayload = base64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function validClaims(nonce: string): Record<string, unknown> {
  return {
    iss: configuration.issuer,
    sub: "external-user-1",
    aud: configuration.clientId,
    exp: nowSeconds + 300,
    iat: nowSeconds - 10,
    nonce,
    email: "student@example.test",
    name: "Student One",
    school_extension: { class: "12A" },
  };
}

type FetchResult = Readonly<{
  fetcher: typeof fetch;
  tokenBodies: URLSearchParams[];
  requests: string[];
}>;

function oidcFetcher(
  token: (body: URLSearchParams) => Promise<Record<string, unknown>>,
): FetchResult {
  const tokenBodies: URLSearchParams[] = [];
  const requests: string[] = [];
  const implementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === configuration.jwksUri) {
      return Response.json({
        keys: [
          {
            ...signingJwk,
            kid: "signing-key",
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    }
    if (url === configuration.tokenEndpoint) {
      const body = new URLSearchParams(String(init?.body));
      tokenBodies.push(body);
      return Response.json(await token(body));
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return {
    fetcher: Object.assign(implementation, {
      preconnect: () => undefined,
    }) as typeof fetch,
    tokenBodies,
    requests,
  };
}

async function initiate(
  provider: ReturnType<typeof createOidcProvider>,
): Promise<{ state: string; nonce: string; challenge: string }> {
  const response = await provider.initiate(
    new Request("https://app.example/login"),
  );
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.origin + location.pathname).toBe(
    configuration.authorizationEndpoint,
  );
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  return {
    state: location.searchParams.get("state") ?? "",
    nonce: location.searchParams.get("nonce") ?? "",
    challenge: location.searchParams.get("code_challenge") ?? "",
  };
}

function callback(state: string, extra = "code=authorization-code"): Request {
  return new Request(
    `${configuration.redirectUri}?state=${encodeURIComponent(state)}&${extra}`,
  );
}

test("correlates PKCE and returns a normalized external identity", async () => {
  const store = new MemoryAttemptStore();
  let nonce = "";
  const http = oidcFetcher(async () => ({
    access_token: "access-token",
    token_type: "Bearer",
    expires_in: 300,
    id_token: await signIdToken(validClaims(nonce)),
  }));
  const provider = createOidcProvider(configuration, {
    attempts: store,
    fetch: http.fetcher,
    now: () => new Date(nowSeconds * 1_000),
  });
  const authorization = await initiate(provider);
  nonce = authorization.nonce;

  const identity = await provider.handleCallback(callback(authorization.state));
  const expectedRaw = validClaims(nonce);
  delete expectedRaw.nonce;

  expect(identity).toEqual({
    providerId: "school-oidc",
    externalId: "external-user-1",
    email: "student@example.test",
    displayName: "Student One",
    raw: expectedRaw,
  });
  expect(identity.raw).not.toHaveProperty("nonce");
  expect(http.tokenBodies).toHaveLength(1);
  const verifier = http.tokenBodies[0]?.get("code_verifier") ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  expect(base64Url(new Uint8Array(digest))).toBe(authorization.challenge);
  expect(http.tokenBodies[0]?.get("client_secret")).toBe("client-secret");
});

test("rejects a state mismatch before exchanging the code", async () => {
  const http = oidcFetcher(async () => {
    throw new Error("token endpoint must not be called");
  });
  const provider = createOidcProvider(configuration, {
    attempts: new MemoryAttemptStore(),
    fetch: http.fetcher,
    now: () => new Date(nowSeconds * 1_000),
  });
  await initiate(provider);

  await expect(
    provider.handleCallback(callback("wrong-state")),
  ).rejects.toMatchObject({
    name: "OidcAuthenticationError",
    reason: "invalid_state",
  });
  expect(http.requests).toEqual([]);
});

test("rejects expired and replayed authorization attempts", async () => {
  let currentSeconds = nowSeconds;
  let nonce = "";
  const http = oidcFetcher(async () => ({
    access_token: "access-token",
    token_type: "Bearer",
    id_token: await signIdToken(validClaims(nonce)),
  }));
  const provider = createOidcProvider(configuration, {
    attempts: new MemoryAttemptStore(),
    fetch: http.fetcher,
    now: () => new Date(currentSeconds * 1_000),
  });
  const expired = await initiate(provider);
  currentSeconds += 301;
  await expect(
    provider.handleCallback(callback(expired.state)),
  ).rejects.toMatchObject({
    reason: "authorization_expired",
  });
  expect(http.requests).toEqual([]);

  currentSeconds = nowSeconds;
  const usable = await initiate(provider);
  nonce = usable.nonce;
  await provider.handleCallback(callback(usable.state));
  await expect(
    provider.handleCallback(callback(usable.state)),
  ).rejects.toMatchObject({
    reason: "invalid_state",
  });
  expect(http.tokenBodies).toHaveLength(1);
});

test("rejects a nonce mismatch", async () => {
  const http = oidcFetcher(async () => ({
    access_token: "access-token",
    token_type: "Bearer",
    id_token: await signIdToken(validClaims("wrong-nonce")),
  }));
  const provider = createOidcProvider(configuration, {
    attempts: new MemoryAttemptStore(),
    fetch: http.fetcher,
    now: () => new Date(nowSeconds * 1_000),
  });
  const authorization = await initiate(provider);

  await expect(
    provider.handleCallback(callback(authorization.state)),
  ).rejects.toMatchObject({
    reason: "invalid_id_token",
  });
});

const invalidTokenCases: Array<
  [
    string,
    (claims: Record<string, unknown>) => Record<string, unknown>,
    () => CryptoKey | undefined,
  ]
> = [
  ["signature", (claims) => claims, () => otherSigningKeys.privateKey],
  [
    "issuer",
    (claims) => ({ ...claims, iss: "https://attacker.example" }),
    () => undefined,
  ],
  [
    "audience",
    (claims) => ({ ...claims, aud: "another-client" }),
    () => undefined,
  ],
  [
    "expiry",
    (claims) => ({ ...claims, exp: nowSeconds - 120 }),
    () => undefined,
  ],
];

test.each(invalidTokenCases)(
  "rejects an invalid ID-token %s",
  async (_label, mutate, key) => {
    let nonce = "";
    const http = oidcFetcher(async () => ({
      access_token: "access-token",
      token_type: "Bearer",
      id_token: await signIdToken(mutate(validClaims(nonce)), key()),
    }));
    const provider = createOidcProvider(configuration, {
      attempts: new MemoryAttemptStore(),
      fetch: http.fetcher,
      now: () => new Date(nowSeconds * 1_000),
    });
    const authorization = await initiate(provider);
    nonce = authorization.nonce;

    await expect(
      provider.handleCallback(callback(authorization.state)),
    ).rejects.toMatchObject({
      reason: "invalid_id_token",
    });
  },
);

test("rejects OAuth error callbacks without exposing provider details", async () => {
  const http = oidcFetcher(async () => {
    throw new Error("token endpoint must not be called");
  });
  const provider = createOidcProvider(configuration, {
    attempts: new MemoryAttemptStore(),
    fetch: http.fetcher,
    now: () => new Date(nowSeconds * 1_000),
  });
  const authorization = await initiate(provider);

  let thrown: unknown;
  try {
    await provider.handleCallback(
      callback(
        authorization.state,
        "error=access_denied&error_description=provider-secret-detail",
      ),
    );
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OidcAuthenticationError);
  expect(thrown).toMatchObject({ reason: "provider_error" });
  expect((thrown as Error).message).not.toContain("provider-secret-detail");
  expect(http.requests).toEqual([]);
});

test.each([
  ["missing ID token", { access_token: "access", token_type: "Bearer" }],
  ["missing access token", { token_type: "Bearer", id_token: "token" }],
  [
    "invalid token type",
    { access_token: "access", token_type: 7, id_token: "token" },
  ],
])("rejects a malformed token response: %s", async (_label, tokenResponse) => {
  const http = oidcFetcher(async () => tokenResponse);
  const provider = createOidcProvider(configuration, {
    attempts: new MemoryAttemptStore(),
    fetch: http.fetcher,
    now: () => new Date(nowSeconds * 1_000),
  });
  const authorization = await initiate(provider);

  await expect(
    provider.handleCallback(callback(authorization.state)),
  ).rejects.toMatchObject({
    reason: "invalid_token_response",
  });
});
