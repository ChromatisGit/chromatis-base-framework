import { commandEnvironment } from "./commandOptions.js";
import { checkInstance, problemsError } from "./instanceCheck.js";
import { fixInstance } from "./instanceFix.js";
import {
  inspectInstance,
  type InspectReport,
  type RouteReport,
} from "./instanceInspect.js";
import { formatProblem } from "./problems.js";

const show = (value: unknown): string => JSON.stringify(value);

function list(values: readonly string[]): string {
  return values.length ? values.join(", ") : "none";
}

function moduleLines(report: InspectReport): string[] {
  if (report.modules.length === 0) {
    return ["  none"];
  }
  return report.modules.flatMap((module) => [
    `  ${module.name}  (${module.entry})`,
    ...(module.config
      ? [
          `    config ${module.config.file}${module.config.present ? "" : " (missing)"}${module.config.required ? ", required" : ""} = ${module.config.effective === undefined ? "invalid (see unmet requirements)" : show(module.config.effective)}`,
        ]
      : []),
    ...(module.runtime.length
      ? [`    runtime ${list(module.runtime)}  hook ${module.serverHook}`]
      : []),
    ...(module.database ? ["    database"] : []),
  ]);
}

function shellLines(report: InspectReport): string[] {
  const shell = report.shell;
  if (!shell) {
    return [];
  }
  const line = (route: RouteReport) =>
    `  ${(route.url ?? "(layout)").padEnd(44)} ${route.id}  ${route.file}  (${route.owner})`;
  return [
    `Root: ${shell.root.source}${shell.root.file ? `  ${shell.root.file}` : ""}`,
    "Routes",
    ...(shell.routes.length ? shell.routes.map(line) : ["  none"]),
    ...(shell.omitted.length
      ? [`Replaced product paths: ${shell.omitted.join(", ")}`]
      : []),
    ...(shell.extraRoutes.length
      ? ["Instance routes (app/routes.ts)", ...shell.extraRoutes.map(line)]
      : []),
  ];
}

/** Human-readable form of the diagnostics report. */
export function renderReport(report: InspectReport): string {
  const app = report.application;
  const lines = [
    `Chromatis instance (${report.mode}, environment ${report.environment})`,
    ...(report.package
      ? [
          `Modules from ${report.package.name}${report.package.version ? `@${report.package.version}` : ""}`,
        ]
      : []),
    ...(app
      ? [
          `Application ${app.name}: target ${app.target}${app.domain ? `, domain ${app.domain}` : ""}${app.publicUrl ? `, ${app.publicUrl}` : ""}`,
        ]
      : []),
    "Modules",
    ...moduleLines(report),
    ...(report.disabledModules.length
      ? [
          "Disabled modules (not in effect)",
          ...report.disabledModules.map(
            (m) =>
              `  ${m.name}  ${m.reason}; contributes nothing (would add: ${
                [
                  ...(m.runtime.length
                    ? [`runtime ${m.runtime.join(", ")}`]
                    : []),
                  ...(m.database ? ["database"] : []),
                  ...(m.secrets.length
                    ? [`secrets ${m.secrets.join(", ")}`]
                    : []),
                  ...(m.contributions.length
                    ? [`contributions ${m.contributions.join(", ")}`]
                    : []),
                  ...(m.artifacts.length
                    ? [`artifacts ${m.artifacts.join(", ")}`]
                    : []),
                ].join("; ") || "nothing"
              })`,
          ),
        ]
      : []),
    ...shellLines(report),
    "Contributions",
    ...(report.contributions.length
      ? report.contributions.map(
          (c) => `  ${c.id}  ${c.specifier}#${c.export}  (${c.module})`,
        )
      : ["  none"]),
    "Artifacts",
    ...(report.artifacts.length
      ? report.artifacts.map(
          (a) =>
            `  ${a.id}  ${a.path}  produced by ${a.producedBy ?? "nothing"}${a.present ? ", present" : ""}${a.validator ? `, validator ${a.validator.module}#${a.validator.export}` : ""}  (${a.module})`,
        )
      : ["  none"]),
    "Secrets",
    ...(report.secrets.length
      ? report.secrets.map(
          (s) =>
            `  ${s.name.padEnd(26)} ${s.configured ? "defined" : "not defined"}  ${s.requirement}${s.requiredNow ? " (needed now)" : ""}  (${s.owner})`,
        )
      : ["  none"]),
    "Unmet requirements",
    ...(report.unmet.length ? report.unmet.map((u) => `  ${u}`) : ["  none"]),
  ];
  return lines.join("\n");
}

/**
 * Runs `check`, `fix` and `inspect`. Returns false for any other command so the
 * caller can try the build and deploy commands.
 */
export async function runInstanceCommand(
  command: string,
  args: readonly string[],
  root: string,
): Promise<boolean> {
  if (command === "check") {
    const problems = await checkInstance(root, {
      environment: commandEnvironment(command, args),
      scripts: !args.includes("--no-scripts"),
    });
    if (problems.length > 0) {
      throw problemsError("check failed", problems);
    }
    console.info("[check] ok");
    return true;
  }
  if (command === "fix") {
    const result = await fixInstance(root);
    for (const file of result.created) {
      console.info(`[fix] created ${file} from schema defaults`);
    }
    for (const file of result.annotated) {
      console.info(`[fix] set the editor schema line of ${file}`);
    }
    console.info(
      result.formatted
        ? `[fix] formatted ${result.formatted.join(", ")}`
        : "[fix] formatting skipped (Prettier is not installed or failed)",
    );
    if (result.remaining.length > 0) {
      throw new Error(
        `fix cannot decide these; edit them yourself:\n${result.remaining.map((p) => `  ${formatProblem(p)}`).join("\n")}`,
      );
    }
    console.info("[fix] nothing left to fix");
    return true;
  }
  if (command === "inspect") {
    const report = await inspectInstance(
      root,
      commandEnvironment(command, args),
    );
    console.info(
      args.includes("--json")
        ? JSON.stringify(report, null, 2)
        : renderReport(report),
    );
    return true;
  }
  return false;
}
