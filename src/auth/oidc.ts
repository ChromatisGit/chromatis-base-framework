import { AppError } from "../errors.js";
import type { Database } from "../db/client.js";
import type { ExternalIdentity, SSOProvider } from "./types.js";

const DEFAULT_ATTEMPT_TTL_SECONDS = 10 * 60;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;

export type OidcConfiguration = Readonly<{
  providerId: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: readonly string[];
  authorizationAttemptTtlSeconds?: number;
  clockToleranceSeconds?: number;
}>;

export type OidcAuthorizationAttempt = Readonly<{
  providerId: string;
  stateHash: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: Date;
}>;

export interface OidcAuthorizationAttemptStore {
  save(attempt: OidcAuthorizationAttempt): Promise<void>;
  consume(
    providerId: string,
    stateHash: string,
  ): Promise<OidcAuthorizationAttempt | null>;
}

export type OidcAuthenticationFailure =
  | "invalid_callback"
  | "invalid_state"
  | "authorization_expired"
  | "provider_error"
  | "token_exchange_failed"
  | "invalid_token_response"
  | "invalid_id_token";

export class OidcAuthenticationError extends AppError {
  public constructor(
    public readonly reason: OidcAuthenticationFailure,
    options?: ErrorOptions,
  ) {
    super("Single sign-on failed", "oidc_authentication_failed", options);
  }
}

export type OidcProviderDependencies = Readonly<{
  attempts: OidcAuthorizationAttemptStore;
  fetch?: typeof fetch;
  crypto?: Crypto;
  now?: () => Date;
}>;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url value");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function parseJwtPart(value: string): JsonObject {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
    decodeBase64Url(value),
  );
  const parsed: unknown = JSON.parse(decoded);
  if (!isObject(parsed)) {
    throw new Error("JWT part must be an object");
  }
  return parsed;
}

function randomValue(webCrypto: Crypto, length = 32): string {
  return base64Url(webCrypto.getRandomValues(new Uint8Array(length)));
}

async function sha256(webCrypto: Crypto, value: string): Promise<string> {
  const digest = await webCrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function singleParameter(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new OidcAuthenticationError("invalid_token_response", {
      cause: error,
    });
  }
}

async function exchangeCode(
  configuration: OidcConfiguration,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  if (configuration.clientSecret) {
    body.set("client_secret", configuration.clientSecret);
  }

  let response: Response;
  try {
    response = await fetcher(configuration.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (error) {
    throw new OidcAuthenticationError("token_exchange_failed", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new OidcAuthenticationError("token_exchange_failed");
  }

  const value = await readJson(response);
  if (
    !isObject(value) ||
    typeof value.access_token !== "string" ||
    value.access_token.length === 0 ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.id_token !== "string" ||
    value.id_token.length === 0 ||
    (value.expires_in !== undefined &&
      (typeof value.expires_in !== "number" || value.expires_in <= 0)) ||
    (value.refresh_token !== undefined &&
      typeof value.refresh_token !== "string")
  ) {
    throw new OidcAuthenticationError("invalid_token_response");
  }
  return value.id_token;
}

async function getSigningKey(
  configuration: OidcConfiguration,
  kid: string,
  fetcher: typeof fetch,
  webCrypto: Crypto,
): Promise<CryptoKey> {
  const response = await fetcher(configuration.jwksUri, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("JWKS request failed");
  }
  const value: unknown = await response.json();
  if (!isObject(value) || !Array.isArray(value.keys)) {
    throw new Error("Invalid JWKS document");
  }
  const key = value.keys.find(
    (candidate): candidate is JsonWebKey & JsonObject =>
      isObject(candidate) &&
      candidate.kid === kid &&
      candidate.kty === "RSA" &&
      (candidate.use === undefined || candidate.use === "sig") &&
      (candidate.alg === undefined || candidate.alg === "RS256"),
  );
  if (!key) {
    throw new Error("No matching signing key");
  }
  return webCrypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function validAudience(audience: unknown, clientId: string): boolean {
  return (
    audience === clientId ||
    (Array.isArray(audience) &&
      audience.length > 0 &&
      audience.every((value) => typeof value === "string") &&
      audience.includes(clientId))
  );
}

async function verifyIdToken(
  configuration: OidcConfiguration,
  idToken: string,
  expectedNonce: string,
  fetcher: typeof fetch,
  webCrypto: Crypto,
  now: Date,
): Promise<JsonObject> {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new Error("Malformed JWT");
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [
      string,
      string,
      string,
    ];
    const header = parseJwtPart(encodedHeader);
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0
    ) {
      throw new Error("Unsupported JWT header");
    }
    const key = await getSigningKey(
      configuration,
      header.kid,
      fetcher,
      webCrypto,
    );
    const validSignature = await webCrypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!validSignature) {
      throw new Error("Invalid JWT signature");
    }

    const claims = parseJwtPart(encodedPayload);
    const tolerance =
      configuration.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
    const currentSeconds = Math.floor(now.getTime() / 1_000);
    const audience = claims.aud;
    if (
      claims.iss !== configuration.issuer ||
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      !validAudience(audience, configuration.clientId) ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= currentSeconds - tolerance ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat) ||
      claims.iat > currentSeconds + tolerance ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== "number" ||
          !Number.isFinite(claims.nbf) ||
          claims.nbf > currentSeconds + tolerance)) ||
      claims.nonce !== expectedNonce
    ) {
      throw new Error("Invalid JWT claims");
    }
    if (
      Array.isArray(audience) &&
      audience.length > 1 &&
      claims.azp !== configuration.clientId
    ) {
      throw new Error("Invalid authorized party");
    }
    return claims;
  } catch (error) {
    if (error instanceof OidcAuthenticationError) {
      throw error;
    }
    throw new OidcAuthenticationError("invalid_id_token", { cause: error });
  }
}

function normalizeIdentity(
  providerId: string,
  claims: JsonObject,
): ExternalIdentity {
  const externalId = claims.sub as string;
  const email = typeof claims.email === "string" ? claims.email : null;
  const displayName =
    typeof claims.name === "string" && claims.name.length > 0
      ? claims.name
      : (email ?? externalId);
  const raw = { ...claims };
  delete raw.nonce;
  return Object.freeze({
    providerId,
    externalId,
    email,
    displayName,
    raw: Object.freeze(raw),
  });
}

export function createOidcProvider(
  configuration: OidcConfiguration,
  dependencies: OidcProviderDependencies,
): SSOProvider {
  if (!configuration.scopes.includes("openid")) {
    throw new Error("OIDC scopes must include openid.");
  }
  const webCrypto = dependencies.crypto ?? crypto;
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const attemptTtl =
    configuration.authorizationAttemptTtlSeconds ?? DEFAULT_ATTEMPT_TTL_SECONDS;

  return {
    async initiate() {
      const state = randomValue(webCrypto);
      const nonce = randomValue(webCrypto);
      const codeVerifier = randomValue(webCrypto, 64);
      const stateHash = await sha256(webCrypto, state);
      await dependencies.attempts.save({
        providerId: configuration.providerId,
        stateHash,
        nonce,
        codeVerifier,
        expiresAt: new Date(now().getTime() + attemptTtl * 1_000),
      });
      const authorizationUrl = new URL(configuration.authorizationEndpoint);
      authorizationUrl.search = new URLSearchParams({
        client_id: configuration.clientId,
        redirect_uri: configuration.redirectUri,
        response_type: "code",
        scope: configuration.scopes.join(" "),
        state,
        nonce,
        code_challenge: await sha256(webCrypto, codeVerifier),
        code_challenge_method: "S256",
      }).toString();
      return new Response(null, {
        status: 302,
        headers: { location: authorizationUrl.toString() },
      });
    },

    async handleCallback(request) {
      const callbackUrl = new URL(request.url);
      const state = singleParameter(callbackUrl, "state");
      if (!state) {
        throw new OidcAuthenticationError("invalid_callback");
      }
      const attempt = await dependencies.attempts.consume(
        configuration.providerId,
        await sha256(webCrypto, state),
      );
      if (!attempt) {
        throw new OidcAuthenticationError("invalid_state");
      }
      if (attempt.expiresAt.getTime() <= now().getTime()) {
        throw new OidcAuthenticationError("authorization_expired");
      }
      if (singleParameter(callbackUrl, "error")) {
        throw new OidcAuthenticationError("provider_error");
      }
      const code = singleParameter(callbackUrl, "code");
      if (!code) {
        throw new OidcAuthenticationError("invalid_callback");
      }
      const idToken = await exchangeCode(
        configuration,
        code,
        attempt.codeVerifier,
        fetcher,
      );
      const claims = await verifyIdToken(
        configuration,
        idToken,
        attempt.nonce,
        fetcher,
        webCrypto,
        now(),
      );
      return normalizeIdentity(configuration.providerId, claims);
    },
  };
}

export function createDatabaseOidcAuthorizationAttemptStore(
  database: Database,
): OidcAuthorizationAttemptStore {
  return {
    async save(attempt) {
      await database.anonTransaction(async (sql) => {
        await sql`
          SELECT chromatis.store_oidc_authorization_attempt(
            ${attempt.providerId},
            ${attempt.stateHash},
            ${attempt.nonce},
            ${attempt.codeVerifier},
            ${attempt.expiresAt}
          )
        `;
      });
    },
    async consume(providerId, stateHash) {
      return database.anonTransaction(async (sql) => {
        const rows = await sql<
          Array<{
            provider: string;
            state_hash: string;
            nonce: string;
            code_verifier: string;
            expires_at: Date | string;
          }>
        >`
          SELECT provider, state_hash, nonce, code_verifier, expires_at
          FROM chromatis.consume_oidc_authorization_attempt(
            ${providerId}, ${stateHash}
          )
        `;
        const row = rows[0];
        return row
          ? {
              providerId: row.provider,
              stateHash: row.state_hash,
              nonce: row.nonce,
              codeVerifier: row.code_verifier,
              expiresAt: new Date(row.expires_at),
            }
          : null;
      });
    },
  };
}
