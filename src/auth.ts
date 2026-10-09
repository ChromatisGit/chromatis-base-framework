export { createAuthDatabase } from "./auth/database.server.js";
export { hashPin, verifyPin } from "./auth/hash.server.js";
export { authMigrations } from "./auth/migrations.js";
export {
  createDatabaseOidcAuthorizationAttemptStore,
  createOidcProvider,
  OidcAuthenticationError,
} from "./auth/oidc.js";
export { hasRole, requireRole } from "./auth/roles.server.js";
export { requireUser, withAuthentication } from "./auth/request-context.js";
export { createSessionManager } from "./auth/session.server.js";
export { resolveExternalIdentity } from "./auth/sso.server.js";
export {
  getUserById,
  loginUser,
  registerUser,
  setUserEnabled,
} from "./auth/users.server.js";
export type {
  AuthDatabase,
  AuthDatabaseOptions,
} from "./auth/database.server.js";
export type {
  AuthContext,
  AuthenticatedRequestHandler,
} from "./auth/request-context.js";
export type {
  OidcAuthenticationFailure,
  OidcAuthorizationAttempt,
  OidcAuthorizationAttemptStore,
  OidcConfiguration,
  OidcProviderDependencies,
} from "./auth/oidc.js";
export type {
  SessionManager,
  SessionManagerOptions,
} from "./auth/session.server.js";
export type {
  ExternalIdentity,
  LoginResult,
  RegisterResult,
  Session,
  SSOProvider,
  User,
} from "./auth/types.js";
