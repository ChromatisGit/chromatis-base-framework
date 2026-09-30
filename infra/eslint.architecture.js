/* global process */
import path from "node:path";

function normalize(filePath) {
  return filePath.replaceAll("\\", "/");
}

function sourcePath(filename, value) {
  if (value.startsWith("@/")) {
    return path.resolve(process.cwd(), "src", value.slice(2));
  }
  if (value.startsWith(".")) {
    return path.resolve(path.dirname(filename), value);
  }
  return null;
}

function location(filePath) {
  const segments = normalize(path.relative(process.cwd(), filePath)).split("/");
  const src = segments.indexOf("src");
  if (src === -1) {
    return null;
  }
  const area = segments[src + 1];
  return {
    area,
    module: area === "modules" ? segments[src + 2] : undefined,
    rest:
      area === "modules" ? segments.slice(src + 3) : segments.slice(src + 2),
  };
}

function checkImport(context, node, value) {
  const filename = context.filename;
  const targetPath = sourcePath(filename, value);
  if (!targetPath) {
    return;
  }
  const from = location(filename);
  const target = location(targetPath);
  if (!from || !target) {
    return;
  }

  if (
    from.area === "helper" &&
    ["app", "modules", "adapter"].includes(target.area)
  ) {
    context.report({
      node,
      message: "Helpers cannot import app, modules, or adapters.",
    });
  }
  if (from.area === "adapter" && ["app", "modules"].includes(target.area)) {
    context.report({ node, message: "Adapters must remain domain-neutral." });
  }
  if (from.area === "modules" && target.area === "app") {
    context.report({
      node,
      message: "Modules cannot import the application composition root.",
    });
  }
  if (
    target.area === "modules" &&
    target.module !== from.module &&
    target.rest.length > 0 &&
    !(
      target.rest.length === 1 &&
      /^index(?:\.[cm]?[jt]sx?)?$/.test(target.rest[0])
    )
  ) {
    context.report({
      node,
      message: `Import module ${target.module} through its public index.`,
    });
  }
}

const dependencyRule = {
  meta: { type: "problem", schema: [], messages: {} },
  create(context) {
    return {
      ImportDeclaration(node) {
        checkImport(context, node, node.source.value);
      },
      ImportExpression(node) {
        if (typeof node.source.value === "string") {
          checkImport(context, node, node.source.value);
        }
      },
    };
  },
};

const moduleLayoutRule = {
  meta: { type: "problem", schema: [], messages: {} },
  create(context) {
    return {
      Program(node) {
        const file = location(context.filename);
        if (
          file?.area === "modules" &&
          file.rest.length === 1 &&
          file.rest[0] !== "index.ts"
        ) {
          context.report({
            node,
            message: "Only index.ts may live directly in a module directory.",
          });
        }
      },
    };
  },
};

export default {
  rules: {
    dependencies: dependencyRule,
    "module-layout": moduleLayoutRule,
  },
};
