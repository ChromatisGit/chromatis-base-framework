#!/bin/sh
# The three Chromatis roles and the application database (see the Chromatis
# README, "PostgreSQL roles"). The Postgres image runs this once, on an empty
# volume; later password changes need ALTER ROLE.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$DATABASE_OWNER_PASSWORD" \
  -v auth_password="$DATABASE_AUTH_PASSWORD" \
  -v runtime_password="$DATABASE_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE chromatis_owner LOGIN PASSWORD :'owner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE chromatis_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE chromatis_auth LOGIN PASSWORD :'auth_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE DATABASE app OWNER chromatis_owner;
\connect app
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO chromatis_owner;
GRANT CONNECT ON DATABASE app TO chromatis_runtime, chromatis_auth;
GRANT USAGE ON SCHEMA public TO chromatis_runtime;
SQL
