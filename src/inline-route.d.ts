export function inlinePackageReexport(
  code: string,
  require: { resolve(specifier: string): string },
): { code: string; source: string } | null;
