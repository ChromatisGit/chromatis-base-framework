import { z } from "../../src/config.js";

const PORT = z.number().int().min(1).max(65535);

/**
 * `config/app.toml`: the instance-level decisions that are not owned by any
 * module. Schema owned by Chromatis. Environment overlays apply, for example
 * `[local.deployment] domain = "localhost"`.
 */
export const appConfigSchema = z
  .object({
    deployment: z
      .object({
        target: z
          .enum(["cloudflare", "bun"])
          .describe(
            "`bun` is the Bun server (Docker); `cloudflare` is Workers.",
          ),
        domain: z
          .string()
          .regex(
            /^(localhost|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*)$/,
            {
              message:
                'must be a lowercase host name such as "example.org" (no scheme, path or port)',
            },
          )
          .describe("Public host name, without scheme or port."),
        name: z
          .string()
          .regex(/^[a-z][a-z0-9-]*$/, {
            message: "must be lowercase letters, digits and hyphens",
          })
          .optional()
          .describe(
            "Worker/service identity. Defaults to the instance package name; set it explicitly to keep an already deployed name.",
          ),
        port: PORT.default(3000).describe("Bun server listen port."),
      })
      .strict()
      .describe("Where and how the instance is deployed."),
    modules: z
      .object({
        disabled: z
          .array(z.string())
          .default([])
          .describe("module names; they contribute nothing and need no config"),
      })
      .strict()
      .prefault({})
      .describe(
        "Modules the product package provides that this instance does not use.",
      ),
    /** Adjustments to the routes the product package provides. */
    routes: z
      .object({
        omit: z
          .array(
            z
              .string()
              .regex(/^\//, { message: "must be a URL path such as /" }),
          )
          .default([])
          .describe("product route paths this instance replaces with its own"),
      })
      .strict()
      .prefault({})
      .describe("Adjustments to the routes the product package provides."),
  })
  .strict();

export type AppConfig = z.output<typeof appConfigSchema>;

export function publicUrl(deployment: AppConfig["deployment"]): string {
  return deployment.domain === "localhost"
    ? `http://localhost:${deployment.port}`
    : `https://${deployment.domain}`;
}
