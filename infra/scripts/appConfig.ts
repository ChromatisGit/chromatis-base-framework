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
        instance: z
          .enum(["built-in", "mounted"])
          .default("built-in")
          .describe(
            "`mounted` builds a generic image: module configuration, artifacts and the site come from the directory mounted at CHROMATIS_INSTANCE when the server starts.",
          ),
        image: z
          .object({
            name: z
              .string()
              .regex(/^[a-z0-9][a-z0-9._/:-]*$/, {
                message: 'must be an image name such as "ghcr.io/org/app"',
              })
              .describe("Image name without tag."),
            tag: z
              .string()
              .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, {
                message: "must be a Docker tag such as 1.4.0",
              })
              .describe("The released version this instance runs."),
          })
          .strict()
          .optional()
          .describe(
            'Run on a published image built with `instance = "mounted"` instead of an own server build; the build exports configuration, artifacts and site for it.',
          ),
        server: z
          .object({
            ssh: z
              .string()
              .regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/, {
                message: 'must be "user@host"',
              })
              .optional()
              .describe(
                "Remote Docker host; without it the deployment runs on this machine.",
              ),
            path: z
              .string()
              .regex(/^\/[A-Za-z0-9._/-]+$/, {
                message: "must be an absolute path",
              })
              .default("/srv/chromatis")
              .describe("Directory of the compose project on the server."),
            backup: z
              .string()
              .min(1)
              .optional()
              .describe(
                "rsync destination of the daily backups, e.g. a Storage Box in another location (user@host:path).",
              ),
          })
          .strict()
          .prefault({})
          .describe("Where an image deployment runs."),
      })
      .strict()
      .superRefine((deployment, context) => {
        if (
          deployment.target === "cloudflare" &&
          deployment.instance === "mounted"
        ) {
          context.addIssue({
            code: "custom",
            path: ["instance"],
            message: 'a mounted instance needs target = "bun"',
          });
        }
        if (deployment.image && deployment.target !== "bun") {
          context.addIssue({
            code: "custom",
            path: ["image"],
            message: 'an image deployment needs target = "bun"',
          });
        }
        if (deployment.image && deployment.instance === "mounted") {
          context.addIssue({
            code: "custom",
            path: ["image"],
            message: "the image itself cannot run on an image",
          });
        }
      })
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
