# Authentication flow

## Requests and Auth Sessions

Auth Sessions (table `auth_sessions`) are separate from Runtime Instances and Classroom Sessions. Auth code connects through `createAuthDatabase(DATABASE_AUTH_URL, …)`, a separate database principal the application's `publicSQL`/`userSQL` credential cannot use. Create one `SessionManager({ auth, cookieName })` for the application and wrap the application handler
with `withAuthentication(sessionManager, handler)`. The wrapper reads the opaque
session cookie and resolves it before calling the handler. It passes a new frozen
`AuthContext` to that request only; module code uses `requireUser(context)` and
never reads mutable process-global identity.

The cookie contains only the random session UUID. It is `HttpOnly`, `Secure`, and
`SameSite=Lax` by default. Missing, malformed, expired, revoked, and disabled-user
sessions all resolve to `null`. `SessionManager.logout(session)` revokes the
current database session and returns the clearing `Set-Cookie` value. Use
`revoke(id)` for one known session or `revokeAll(user)` for every device.

The wrapper accepts and returns standard Fetch `Request` and `Response` objects;
the same handler is used on Bun and Cloudflare.

## Accounts with a one-time link

For applications whose operator creates accounts by hand (no self-registration),
`createAccount(auth, { username, roles })` creates an enabled User without a
password and assigns roles the application has seeded. `issueSetupLink(auth, user)`
returns a random token (default lifetime `DEFAULT_SETUP_LINK_SECONDS`, 7 days) that
the application turns into a link; only its SHA-256 is stored in
`password_setup_tokens`, one per User, so a new link replaces the old one and
"forgot password" is simply a new link. `redeemSetupLink(auth, token, password)`
consumes the token, stores an Argon2id hash, and revokes every Auth Session of the
User; disabled Users and expired tokens are rejected. `setupLinkValid` checks a
token without using it up. `loginUser` records `last_login_at`; `listAccounts`
returns every User with a username, their roles, when the password was set, the
last login and the open link's expiry. None of these check a role: the caller
(an admin page, a command-line bootstrap) decides who may use them. Disabling a
User with `setUserEnabled(…, false)` makes its sessions resolve to `null`;
`revokeAll(user)` also deletes them.

## Generic OIDC

`createOidcProvider(configuration, dependencies)` implements the provider-neutral
`SSOProvider.initiate()` / `handleCallback()` contract. Applications supply only
issuer/endpoints/client configuration and the framework database attempt store.
Provider-specific claims or tenant policy belong in an application adapter.

`initiate()` creates state, nonce, and an S256 PKCE verifier. Only state, nonce,
and the PKCE challenge enter the authorization redirect. The verifier and the
hashed state correlation are stored server-side with an expiry.

`handleCallback()` atomically consumes that attempt before token exchange, so a
callback is one-time. It rejects state mismatches, expired attempts, replay,
provider error callbacks, and malformed token responses with a generic typed
error. It validates the ID-token RS256 signature against JWKS, then issuer,
audience/authorized party, expiry, issued/not-before times, subject, and nonce.
Access tokens, refresh tokens, authorization codes, raw ID tokens, client
secrets, and PKCE verifiers are neither returned in the normalized identity nor
persisted as identity data.

The resulting `ExternalIdentity` contains the configured provider ID, OIDC
subject, standard email/name values, and verified claims. `resolveExternalIdentity`
links or auto-provisions the internal user transactionally; concurrent first
callbacks for the same provider subject serialize to the same user.
