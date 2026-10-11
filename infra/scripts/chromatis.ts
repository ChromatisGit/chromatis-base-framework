#!/usr/bin/env bun
import { main } from "./deployment.js";

main().catch((error: unknown) => {
  console.error(
    `[chromatis] ${error instanceof Error ? error.message : "Command failed"}`,
  );
  process.exitCode = 1;
});
