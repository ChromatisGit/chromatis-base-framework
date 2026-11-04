/** Validate the bounded values used for transaction-local RLS capabilities. */
export function validCapability(
  key: "share_token" | "classroom_code",
  value: string,
): boolean {
  return key === "share_token"
    ? /^[A-Za-z0-9_-]{22}$/.test(value)
    : /^[A-Z0-9]{4}$/.test(value);
}
