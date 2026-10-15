/**
 * Set by `chromatis dev --open` for that one development server. The production
 * server entries remove it, so no deployed instance can run with it.
 */
export const DEV_OPEN_VARIABLE = "CHROMATIS_DEV_OPEN";

/**
 * True when the development server was started with `--open`: a product skips
 * its login and treats the browser as it does in a demo. Server-side only.
 */
export function devOpen(
  env: Record<string, string | undefined> = typeof process === "undefined"
    ? {}
    : process.env,
): boolean {
  return env[DEV_OPEN_VARIABLE] === "1";
}
