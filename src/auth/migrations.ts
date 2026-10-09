import type { MigrationAsset } from "../db/types.js";

// Framework state (users, Auth Sessions, role assignments, external identities,
// OIDC attempts) is reachable only by the separate chromatis_auth principal,
// which only framework auth code connects as. chromatis_runtime, the role
// application SQL runs as, has no privileges on it, so holding the runtime
// credential never allows impersonation, role assignment or reading secrets.
// The single SECURITY DEFINER function is has_role(), which reveals only the
// roles of the current User.
const createAuthSchema = `
CREATE SCHEMA IF NOT EXISTS chromatis;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE,
  pin_hash text,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((username IS NULL) = (pin_hash IS NULL))
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

CREATE TABLE roles (
  key text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_key)
);

CREATE TABLE external_identities (
  provider text NOT NULL,
  external_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text,
  display_name text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (provider, external_id)
);

REVOKE ALL ON TABLE users, auth_sessions, roles, user_roles, external_identities FROM PUBLIC;
GRANT USAGE ON SCHEMA chromatis TO chromatis_runtime;

GRANT SELECT, INSERT, UPDATE (enabled) ON users TO chromatis_auth;
GRANT SELECT, INSERT, DELETE ON auth_sessions TO chromatis_auth;
GRANT SELECT, INSERT ON roles, user_roles, external_identities TO chromatis_auth;

-- The User ID propagated by userSQL / userTransaction, or NULL without a User.
CREATE FUNCTION chromatis.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid;
$$;

-- Role check for RLS policies; user_roles itself is not readable by runtime SQL.
CREATE FUNCTION chromatis.has_role(requested_role_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = chromatis.current_user_id()
      AND ur.role_key = requested_role_key
  );
$$;

REVOKE ALL ON FUNCTION chromatis.current_user_id(), chromatis.has_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chromatis.current_user_id(), chromatis.has_role(text) TO chromatis_runtime;
`;

const addOidcAuthorizationAttempts = `
CREATE TABLE oidc_authorization_attempts (
  provider text NOT NULL,
  state_hash text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, state_hash)
);
CREATE INDEX oidc_authorization_attempts_expires_at_idx
  ON oidc_authorization_attempts (expires_at);

REVOKE ALL ON TABLE oidc_authorization_attempts FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON oidc_authorization_attempts TO chromatis_auth;
`;

export const authMigrations: readonly MigrationAsset[] = [
  {
    module: "chromatis-auth",
    version: "1.0.0",
    description: "create users auth sessions roles and external identities",
    sql: createAuthSchema,
  },
  {
    module: "chromatis-auth",
    version: "1.1.0",
    description: "add OIDC authorization attempts",
    sql: addOidcAuthorizationAttempts,
  },
];
