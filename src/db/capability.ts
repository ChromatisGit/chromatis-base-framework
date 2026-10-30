/** Validate the bounded values used for transaction-local RLS capabilities. */
export function validCapability(
  key: "share_token" | "classroom_code",
  value: string,
): boolean {
  return key === "share_token"
    ? /^[a-f0-9]{48}$/.test(value)
    : /^[A-Z0-9]{4}$/.test(value);
}
