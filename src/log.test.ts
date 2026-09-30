import { expect, test } from "bun:test";
import { createLogger } from "./log.js";
import type { LogEntry } from "./log.js";

test("logger preserves request context", () => {
  const entries: LogEntry[] = [];
  const logger = createLogger(
    { requestId: "request-1", module: "courses", userId: "user-1" },
    (entry) => entries.push(entry),
  );
  logger.info("Course loaded", { courseId: "course-1" });
  expect(entries).toEqual([
    {
      requestId: "request-1",
      module: "courses",
      userId: "user-1",
      level: "info",
      message: "Course loaded",
      data: { courseId: "course-1" },
    },
  ]);
});
