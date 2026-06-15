// Column type categories — controls which persistence targets receive the column.
// "shared"     → Postgres + SQLite
// "serverOnly" → Postgres only   (e.g. user_id, server_version)
// "clientOnly" → SQLite only     (e.g. sync_state, last_sync_error)
export type Target = "shared" | "serverOnly" | "clientOnly";
export type TsType = "string" | "number" | "boolean" | "unknown";

// Runtime shape stored in every ColDef object.
// Property names are prefixed with "is" where they would clash with builder
// method names (nullable, primaryKey) that ColBuilder declares via extension.
export interface ColDef<
  TNullable extends boolean = boolean,
  TTarget extends Target = Target,
  TTsType extends TsType = TsType,
> {
  pgType: string;
  sqliteType: string;
  isNullable: TNullable;
  isPrimaryKey: boolean;
  defaultValue: string | undefined;
  target: TTarget;
  // Phantom field — drives TypeScript inference in PgRow<T> / SlRow<T>.
  // Exists as a type-level annotation only; runtime value is undefined.
  _tsType: TTsType;
}

// Builder returned by every col.xxx() factory. Each method returns a new
// builder with updated generic parameters so callers get precise types.
export interface ColBuilder<
  TNullable extends boolean,
  TTarget extends Target,
  TTsType extends TsType,
> extends ColDef<TNullable, TTarget, TTsType> {
  nullable(): ColBuilder<true, TTarget, TTsType>;
  notNull(): ColBuilder<false, TTarget, TTsType>;
  default(expr: string): ColBuilder<TNullable, TTarget, TTsType>;
  primaryKey(): ColBuilder<TNullable, TTarget, TTsType>;
  serverOnly(): ColBuilder<TNullable, "serverOnly", TTsType>;
  clientOnly(): ColBuilder<TNullable, "clientOnly", TTsType>;
}

function makeBuilder<
  TNullable extends boolean,
  TTarget extends Target,
  TTsType extends TsType,
>(
  def: ColDef<TNullable, TTarget, TTsType>,
): ColBuilder<TNullable, TTarget, TTsType> {
  return {
    ...def,
    nullable: () => makeBuilder({ ...def, isNullable: true as const }),
    notNull: () => makeBuilder({ ...def, isNullable: false as const }),
    default: (expr) => makeBuilder({ ...def, defaultValue: expr }),
    primaryKey: () => makeBuilder({ ...def, isPrimaryKey: true }),
    serverOnly: () =>
      makeBuilder({ ...def, target: "serverOnly" as const }),
    clientOnly: () =>
      makeBuilder({ ...def, target: "clientOnly" as const }),
  };
}

function base<TTsType extends TsType>(
  pgType: string,
  sqliteType: string,
  tsType: TTsType,
): ColBuilder<false, "shared", TTsType> {
  return makeBuilder({
    pgType,
    sqliteType,
    isNullable: false,
    isPrimaryKey: false,
    defaultValue: undefined,
    target: "shared",
    _tsType: tsType,
  });
}

// Column type factories.
export const col = {
  uuid: () => base("UUID", "TEXT", "string" as const),
  text: () => base("TEXT", "TEXT", "string" as const),
  integer: () => base("INTEGER", "INTEGER", "number" as const),
  bigint: () => base("BIGINT", "INTEGER", "number" as const),
  boolean: () => base("BOOLEAN", "INTEGER", "boolean" as const),
  timestamp: () => base("TIMESTAMPTZ", "TEXT", "string" as const),
  json: () => base("JSONB", "TEXT", "unknown" as const),

  // Pre-configured client-only sync column.
  // Generates: TEXT NOT NULL DEFAULT 'synced' (SQLite only).
  syncState: (): ColBuilder<false, "clientOnly", "string"> =>
    makeBuilder({
      pgType: "TEXT",
      sqliteType: "TEXT",
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: "'synced'",
      target: "clientOnly",
      _tsType: "string",
    }),
};
