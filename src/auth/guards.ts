import { getSession } from "./session.js";
import type { UserDTO } from "./userStore.js";

/**
 * Reads the session from the request and returns the authenticated user.
 * Throws a redirect Response to /access if the user is not logged in.
 */
export async function requireUser(request: Request): Promise<UserDTO> {
  const user = await getSession(request);
  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: "/access" },
    });
  }
  return user;
}

/**
 * Reads the session from the request and returns the authenticated admin user.
 * Throws 403 if the user is not logged in or not an admin.
 */
export async function requireAdmin(request: Request): Promise<UserDTO> {
  const user = await getSession(request);
  if (!user || user.role !== "admin") {
    throw new Response(null, { status: 403 });
  }
  return user;
}

export function isAdmin(user: UserDTO): boolean {
  return user.role === "admin";
}
