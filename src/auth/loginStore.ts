import { anonSQL } from "../db/client.js";
import { verifyPin } from "./crypto.js";
import type { UserDTO } from "./userStore.js";

type RawAttemptResult = {
  allowed: boolean;
  reason?: "locked" | "too_many_attempts";
};

type StoredUserRow = {
  id: string;
  role: "admin" | "user";
  group_key: string | null;
  access_code: string;
  pin_hash: string;
  course_ids: string[];
};

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return "unknown";
}

/**
 * Authenticates a user by access code + PIN with SQL-based rate limiting.
 * Returns null on any failure (wrong code, wrong PIN, rate limited).
 */
export async function getAuthenticatedUser(
  accessCode: string,
  pin: string,
  ip: string,
): Promise<UserDTO | null> {
  const normalizedIp = ip?.trim() || "unknown";
  const ipKey = `ip:${normalizedIp}`;
  const codeKey = `code_ip:${accessCode}:${normalizedIp}`;

  const checkAttempt = async (bucketKey: string, success: boolean): Promise<boolean> => {
    const rows = await anonSQL<{ check_and_record_attempt: RawAttemptResult }[]>`
      SELECT check_and_record_attempt(${bucketKey}, ${success})
    `;
    const raw = rows[0]?.check_and_record_attempt;
    if (!raw) throw new Error("check_and_record_attempt returned no result");
    return raw.allowed;
  };

  try {
    const [ipAllowed, codeAllowed] = await Promise.all([
      checkAttempt(ipKey, false),
      checkAttempt(codeKey, false),
    ]);
    if (!ipAllowed || !codeAllowed) return null;

    const rows = await anonSQL<StoredUserRow[]>`
      SELECT id, role, group_key, access_code, pin_hash, course_ids
      FROM get_user_for_login(${accessCode})
    `;
    const stored = rows[0];
    const ok = stored ? await verifyPin(pin, stored.pin_hash) : false;

    if (stored && ok) {
      await Promise.all([checkAttempt(ipKey, true), checkAttempt(codeKey, true)]);
      return {
        id: stored.id,
        role: stored.role,
        groupKey: stored.group_key,
        courseIds: stored.course_ids,
      };
    }

    return null;
  } catch (error) {
    console.error("[Auth] Authentication failed:", error);
    return null;
  }
}
