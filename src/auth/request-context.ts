import { UnauthenticatedError } from "../errors.js";
import type { SessionManager } from "./session.server.js";
import type { Session, User } from "./types.js";

export type AuthContext = Readonly<{ session: Session | null }>;

export type AuthenticatedRequestHandler = (
  request: Request,
  context: AuthContext,
) => Promise<Response>;

function immutableSession(session: Session): Session {
  const expiresAt = session.expiresAt.getTime();
  return Object.freeze({
    id: session.id,
    user: Object.freeze({ id: session.user.id }),
    get expiresAt() {
      return new Date(expiresAt);
    },
  });
}

export function withAuthentication(
  sessions: Pick<SessionManager, "resolve">,
  handler: AuthenticatedRequestHandler,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const resolved = await sessions.resolve(request);
    const session = resolved ? immutableSession(resolved) : null;
    const context: AuthContext = Object.freeze({ session });
    return handler(request, context);
  };
}

export function requireUser(context: AuthContext): User {
  if (!context.session) {
    throw new UnauthenticatedError();
  }
  return context.session.user;
}
