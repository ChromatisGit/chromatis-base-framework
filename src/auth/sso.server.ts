import type { AuthDatabase } from "./database.server.js";
import type { ExternalIdentity, User } from "./types.js";

export async function resolveExternalIdentity(
  auth: AuthDatabase,
  identity: ExternalIdentity,
): Promise<User> {
  return auth.transaction(async (sql) => {
    await sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${identity.providerId},
          hashtextextended(${identity.externalId}, 0)
        )
      )
    `;
    const existing = await sql<Array<{ user_id: string }>>`
      SELECT user_id FROM external_identities
      WHERE provider = ${identity.providerId} AND external_id = ${identity.externalId}
      LIMIT 1
    `;
    if (existing[0]) {
      return { id: existing[0].user_id };
    }
    const users = await sql<Array<{ id: string }>>`
      INSERT INTO users (enabled) VALUES (true) RETURNING id
    `;
    const user = users[0];
    if (!user) {
      throw new Error("Failed to create SSO user");
    }
    await sql`
      INSERT INTO external_identities
        (provider, external_id, user_id, email, display_name, raw)
      VALUES
        (${identity.providerId}, ${identity.externalId}, ${user.id}, ${identity.email}, ${identity.displayName}, ${JSON.stringify(identity.raw)}::jsonb)
    `;
    return { id: user.id };
  });
}
