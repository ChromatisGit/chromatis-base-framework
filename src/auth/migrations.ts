import type { MigrationAsset } from "../db/types.js";

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

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE roles (
  key text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE permissions (
  key text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE role_permissions (
  role_key text NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
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

CREATE OR REPLACE FUNCTION chromatis.has_permission(target_user_id uuid, requested_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_key = ur.role_key
    WHERE ur.user_id = target_user_id
      AND rp.permission_key = requested_permission_key
  );
$$;

REVOKE ALL ON TABLE users, sessions, roles, permissions, role_permissions, user_roles, external_identities FROM PUBLIC;
REVOKE ALL ON FUNCTION chromatis.has_permission(uuid, text) FROM PUBLIC;

GRANT SELECT (id, username, pin_hash, enabled), INSERT (username, pin_hash, enabled), UPDATE (enabled) ON users TO chromatis_app;
GRANT SELECT (id, user_id, expires_at), INSERT (id, user_id, expires_at), DELETE ON sessions TO chromatis_app;
GRANT INSERT (key, description) ON roles TO chromatis_app;
GRANT SELECT (role_key, permission_key) ON role_permissions TO chromatis_app;
GRANT SELECT (user_id, role_key), INSERT (user_id, role_key) ON user_roles TO chromatis_app;
GRANT SELECT (provider, external_id, user_id), INSERT (provider, external_id, user_id, email, display_name, raw) ON external_identities TO chromatis_app;
GRANT USAGE ON SCHEMA chromatis TO chromatis_app;
GRANT EXECUTE ON FUNCTION chromatis.has_permission(uuid, text) TO chromatis_app;
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

CREATE OR REPLACE FUNCTION chromatis.store_oidc_authorization_attempt(
  attempt_provider text,
  attempt_state_hash text,
  attempt_nonce text,
  attempt_code_verifier text,
  attempt_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.oidc_authorization_attempts WHERE expires_at <= now();
  INSERT INTO public.oidc_authorization_attempts
    (provider, state_hash, nonce, code_verifier, expires_at)
  VALUES
    (attempt_provider, attempt_state_hash, attempt_nonce, attempt_code_verifier, attempt_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION chromatis.consume_oidc_authorization_attempt(
  attempt_provider text,
  attempt_state_hash text
)
RETURNS TABLE (
  provider text,
  state_hash text,
  nonce text,
  code_verifier text,
  expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM public.oidc_authorization_attempts AS attempt
  WHERE attempt.provider = attempt_provider
    AND attempt.state_hash = attempt_state_hash
  RETURNING
    attempt.provider,
    attempt.state_hash,
    attempt.nonce,
    attempt.code_verifier,
    attempt.expires_at;
END;
$$;

REVOKE ALL ON TABLE oidc_authorization_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION chromatis.store_oidc_authorization_attempt(text, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION chromatis.consume_oidc_authorization_attempt(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION chromatis.store_oidc_authorization_attempt(text, text, text, text, timestamptz) TO chromatis_app;
GRANT EXECUTE ON FUNCTION chromatis.consume_oidc_authorization_attempt(text, text) TO chromatis_app;
`;

export const authMigrations: readonly MigrationAsset[] = [
  {
    module: "chromatis-auth",
    version: "1.0.0",
    description:
      "create users sessions roles permissions and external identities",
    sql: createAuthSchema,
  },
  {
    module: "chromatis-auth",
    version: "1.1.0",
    description: "add OIDC authorization attempts",
    sql: addOidcAuthorizationAttempts,
  },
];
