/**
 * Architecture boundary checker.
 *
 * Derives layer directories from tsconfig path aliases, so it works with
 * any project structure.
 *
 * Required tsconfig aliases (at minimum):
 *   @features/*  → feature vertical slices
 *   @core/*      → app-level composition layer
 *
 * Optional tsconfig aliases:
 *   @platform/*  → shared platform layer (omit if not present)
 *
 * Rules enforced:
 *   platform → must not import features, core, or app
 *   core     → must not import features
 *   feature A → must not import feature B
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT_DIR = process.cwd();
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.json");
const APP_DIR = path.join(ROOT_DIR, "app");

type FileLayer =
  | { kind: "platform" }
  | { kind: "feature"; featureName: string }
  | { kind: "core" }
  | { kind: "app" }
  | { kind: "ignore" };

type Violation = {
  filePath: string;
  line: number;
  column: number;
  specifier: string;
  resolvedPath: string;
  message: string;
};

function fail(message: string): never {
  console.error(`Architecture boundary check failed\n\n${message}\n`);
  process.exit(1);
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath);
}

function isWithin(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toPosixRelative(filePath: string): string {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join("/");
}

/** Resolve the first concrete directory from a tsconfig paths entry like ["./src/platform/*"]. */
function resolveAliasDir(patterns: string[]): string | null {
  const first = patterns[0];
  if (!first) return null;
  // Strip the trailing /* wildcard
  const dirPattern = first.endsWith("/*") ? first.slice(0, -2) : first;
  return path.resolve(ROOT_DIR, dirPattern);
}

function readTsConfig(): ts.ParsedCommandLine {
  const configText = readFileSync(TSCONFIG_PATH, "utf8");
  const configJson = ts.parseConfigFileTextToJson(TSCONFIG_PATH, configText);

  if (configJson.error) {
    fail(ts.flattenDiagnosticMessageText(configJson.error.messageText, "\n"));
  }

  return ts.parseJsonConfigFileContent(
    configJson.config,
    ts.sys,
    ROOT_DIR,
    undefined,
    TSCONFIG_PATH,
  );
}

function resolveDirsFromConfig(config: ts.ParsedCommandLine): {
  platformDir: string | null;
  featuresDir: string;
  coreDir: string | null;
} {
  const paths = config.options.paths ?? {};

  const platformPatterns = paths["@platform/*"];
  const featuresPatterns = paths["@features/*"];
  const corePatterns = paths["@core/*"];

  if (!featuresPatterns || featuresPatterns.length === 0) {
    fail("tsconfig.json must define @features/* path alias for boundary checking.");
  }

  const platformDir = platformPatterns ? resolveAliasDir(platformPatterns) : null;
  const featuresDir = resolveAliasDir(featuresPatterns!);
  const coreDir = corePatterns ? resolveAliasDir(corePatterns) : null;

  if (!featuresDir) fail("Could not resolve @features/* path alias to a directory.");

  return { platformDir, featuresDir: featuresDir!, coreDir };
}

function getFeatureName(filePath: string, featuresDir: string): string | null {
  if (!isWithin(filePath, featuresDir)) return null;
  const relative = path.relative(featuresDir, filePath);
  const segments = relative.split(path.sep);
  return segments.length >= 2 ? (segments[0] ?? null) : null;
}

function classifyFile(
  filePath: string,
  platformDir: string | null,
  featuresDir: string,
  coreDir: string | null,
): FileLayer {
  const normalized = normalizePath(filePath);

  if (platformDir && isWithin(normalized, platformDir)) return { kind: "platform" };

  if (isWithin(normalized, featuresDir)) {
    const featureName = getFeatureName(normalized, featuresDir);
    return featureName ? { kind: "feature", featureName } : { kind: "core" };
  }

  if (coreDir && isWithin(normalized, coreDir)) {
    const relToCore = path.relative(coreDir, normalized);
    if (relToCore.split(path.sep).includes("routes")) return { kind: "app" };
    return { kind: "core" };
  }

  if (isWithin(normalized, APP_DIR)) return { kind: "app" };

  return { kind: "ignore" };
}

function getModuleSpecifiers(sourceFile: ts.SourceFile): Array<{ text: string; node: ts.Node }> {
  const specs: Array<{ text: string; node: ts.Node }> = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && ts.isStringLiteralLike(specifier)) {
        specs.push({ text: specifier.text, node: specifier });
      }
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        specs.push({ text: firstArg.text, node: firstArg });
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteralLike(literal)) {
        specs.push({ text: literal.text, node: literal });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specs;
}

function createResolver(options: ts.CompilerOptions) {
  const cache = ts.createModuleResolutionCache(ROOT_DIR, (value) => value, options);
  const host: ts.ModuleResolutionHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };

  return (specifier: string, containingFile: string): string | null => {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host, cache)
      .resolvedModule;

    if (!resolved) return null;

    const resolvedFile = resolved.resolvedFileName;
    if (resolvedFile.includes("node_modules")) return null;
    if (!path.isAbsolute(resolvedFile)) return null;

    return normalizePath(resolvedFile);
  };
}

function getViolationMessage(sourceLayer: FileLayer, targetLayer: FileLayer): string | null {
  if (sourceLayer.kind === "platform") {
    if (targetLayer.kind === "feature") return "Platform code must not import feature code.";
    if (targetLayer.kind === "core") return "Platform code must not import core code.";
    if (targetLayer.kind === "app") return "Platform code must not import app code.";
    return null;
  }

  if (sourceLayer.kind === "core") {
    if (targetLayer.kind === "feature") {
      return "Core code must not import feature code.";
    }
    return null;
  }

  if (sourceLayer.kind === "feature") {
    if (
      targetLayer.kind === "feature"
      && targetLayer.featureName !== sourceLayer.featureName
    ) {
      return `Feature "${sourceLayer.featureName}" must not import feature "${targetLayer.featureName}".`;
    }
    return null;
  }

  return null;
}

function main(): void {
  const config = readTsConfig();
  const { platformDir, featuresDir, coreDir } = resolveDirsFromConfig(config);
  const resolveModule = createResolver(config.options);

  const files = config.fileNames
    .map((filePath) => normalizePath(filePath))
    .filter((filePath) => /\.(ts|tsx|mts|cts)$/.test(filePath));

  const violations: Violation[] = [];

  for (const filePath of files) {
    const sourceLayer = classifyFile(filePath, platformDir, featuresDir, coreDir);
    if (sourceLayer.kind === "ignore") continue;

    const sourceText = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
    const specs = getModuleSpecifiers(sourceFile);

    for (const spec of specs) {
      const resolvedPath = resolveModule(spec.text, filePath);
      if (!resolvedPath) continue;

      const targetLayer = classifyFile(resolvedPath, platformDir, featuresDir, coreDir);
      if (targetLayer.kind === "ignore") continue;

      const message = getViolationMessage(sourceLayer, targetLayer);
      if (!message) continue;

      const pos = sourceFile.getLineAndCharacterOfPosition(spec.node.getStart(sourceFile));
      violations.push({
        filePath,
        line: pos.line + 1,
        column: pos.character + 1,
        specifier: spec.text,
        resolvedPath,
        message,
      });
    }
  }

  if (violations.length > 0) {
    const details = violations
      .sort((a, b) => {
        const fc = a.filePath.localeCompare(b.filePath);
        if (fc !== 0) return fc;
        if (a.line !== b.line) return a.line - b.line;
        return a.column - b.column;
      })
      .map((v) =>
        [
          `${toPosixRelative(v.filePath)}:${v.line}:${v.column}`,
          `  ${v.message}`,
          `  import: ${v.specifier}`,
          `  resolved: ${toPosixRelative(v.resolvedPath)}`,
        ].join("\n"),
      )
      .join("\n\n");

    fail(details);
  }

  console.log("Architecture boundary check passed.");
}

main();
