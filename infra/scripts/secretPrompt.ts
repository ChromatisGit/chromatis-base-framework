/** Reads a secret from a terminal while displaying only asterisks. */
export async function promptSecret(name: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error(
      `Run bun run secret set ${name} in an interactive terminal`,
    );
  }
  process.stdout.write(`${name}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    for await (const chunk of process.stdin) {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          return value;
        }
        if (char === "\u0003") {
          throw new Error("Cancelled");
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " " && char !== "\u007f") {
          value += char;
          process.stdout.write("*");
        }
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return value;
}
