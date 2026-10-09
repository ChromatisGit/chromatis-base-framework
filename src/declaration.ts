import { parse } from "smol-toml";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const variableName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

export const applicationDeclarationSchema = z
  .object({
    name: identifier,
    publicUrl: z.string().url(),
    target: z.enum(["cloudflare", "docker"]).default("cloudflare"),
    postgresql: z.boolean().default(false),
    port: z.number().int().min(1).max(65535).default(3000),
    runtime: z.array(identifier).default([]),
    secrets: z.array(variableName).default([]),
    optionalSecrets: z.array(variableName).default([]),
    variables: z.record(variableName, z.string()).default({}),
    contentMounts: z.record(identifier, z.string()).default({}),
    serverHook: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.runtime.length > 0 && !value.serverHook) {
      context.addIssue({
        code: "custom",
        path: ["serverHook"],
        message: "serverHook is required for Stateful Runtime",
      });
    }
    for (const [name, values] of [
      ["runtime", value.runtime],
      ["secrets", value.secrets],
      ["optionalSecrets", value.optionalSecrets],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `${name} contains duplicates`,
        });
      }
    }
    for (const secret of [...value.secrets, ...value.optionalSecrets]) {
      if (secret in value.variables) {
        context.addIssue({
          code: "custom",
          path: ["variables", secret],
          message: "A secret cannot also be a variable",
        });
      }
    }
  });

export type ApplicationDeclaration = z.infer<
  typeof applicationDeclarationSchema
>;

export function parseApplicationDeclaration(
  source: string,
): ApplicationDeclaration {
  const document = parse(source);
  return applicationDeclarationSchema.parse(document);
}
