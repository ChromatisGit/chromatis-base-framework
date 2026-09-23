# Authentication flow

## Requests and sessions

Create one `SessionManager` for the application and wrap the application handler
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
