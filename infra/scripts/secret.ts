const knownSecrets = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "SESSION_SECRET",
] as const;

for (const name of knownSecrets) {
  const value = process.env[name];
  if (!value) {
    console.info(`[secret] ${name}: missing`);
    continue;
  }
  if (name === "DATABASE_URL" || name === "DATABASE_MIGRATION_URL") {
    const url = new URL(value);
    console.info(
      `[secret] ${name}: configured (${url.hostname}/${url.pathname.replace(/^\//, "")}, user ${url.username}, password ********)`,
    );
  } else {
    console.info(`[secret] ${name}: configured`);
  }
}
