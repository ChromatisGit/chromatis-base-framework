/** One finding about an instance: where it is, which key, what is wrong. */
export type Problem = Readonly<{
  /** File (relative to the instance root), package or area. */
  source: string;
  /** Key path inside the source, when the finding concerns a single key. */
  key?: string;
  message: string;
}>;

export function formatProblem(problem: Problem): string {
  const key = problem.key ? `: ${problem.key}` : "";
  return `${problem.source}${key}: ${problem.message}`;
}

/** Thrown when an instance cannot be used; carries every finding. */
export class InstanceProblemsError extends Error {
  public constructor(public readonly problems: readonly Problem[]) {
    super(problems.map(formatProblem).join("\n"));
    this.name = "InstanceProblemsError";
  }
}
