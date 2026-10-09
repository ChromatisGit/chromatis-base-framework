const CTRL_C = "\u0003";
const ESCAPE = "\u001b";
const ERASE_BELOW = "\u001b[J";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

export interface SecretTerminal {
  /** Shows a list; resolves with the chosen index, or null when dismissed. */
  select(title: string, options: readonly string[]): Promise<number | null>;
  /** Reads a value with only asterisks echoed; null when dismissed. */
  prompt(name: string): Promise<string | null>;
  print(line: string): void;
}

function requireTerminal(): void {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Run bun run secret in an interactive terminal");
  }
}

let rawDepth = 0;

/** Holds the terminal in raw mode so keystrokes are never echoed. */
async function withRawInput<T>(
  action: (next: () => Promise<string>) => Promise<T>,
): Promise<T> {
  requireTerminal();
  const input = process.stdin;
  if (rawDepth++ === 0) {
    input.setRawMode(true);
    input.resume();
  }
  const next = () =>
    new Promise<string>((resolve) => {
      input.once("data", (chunk) => resolve(String(chunk)));
    });
  try {
    return await action(next);
  } finally {
    if (--rawDepth === 0) {
      input.setRawMode(false);
      input.pause();
    }
  }
}

/** Reads a secret from a terminal while displaying only asterisks. */
export async function promptSecret(name: string): Promise<string> {
  const value = await readSecret(name);
  if (value === null) {
    throw new Error("Cancelled");
  }
  return value;
}

async function readSecret(name: string): Promise<string | null> {
  return withRawInput(async (next) => {
    process.stdout.write(`${name}: `);
    let value = "";
    for (;;) {
      const chunk = await next();
      if (chunk === ESCAPE) {
        process.stdout.write("\n");
        return null;
      }
      // Arrow keys and other escape sequences are not part of the value.
      if (chunk.startsWith(ESCAPE)) {
        continue;
      }
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          return value;
        }
        if (char === CTRL_C) {
          process.stdout.write("\n");
          return null;
        }
        if (char === "\u007f") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    }
  });
}

async function chooseOption(
  title: string,
  options: readonly string[],
): Promise<number | null> {
  return withRawInput(async (next) => {
    let selected = 0;
    let drawn = 0;
    const draw = () => {
      if (drawn > 0) {
        process.stdout.write(`\u001b[${drawn}A\r${ERASE_BELOW}`);
      }
      const lines = [
        title,
        ...options.map(
          (option, index) => `${index === selected ? "›" : " "} ${option}`,
        ),
        "  ↑/↓ move · enter select · esc back",
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
      drawn = lines.length;
    };
    const finish = () => {
      process.stdout.write(`\u001b[${drawn}A\r${ERASE_BELOW}${SHOW_CURSOR}`);
    };
    process.stdout.write(HIDE_CURSOR);
    try {
      draw();
      for (;;) {
        const key = await next();
        if (key === "\u001b[A" || key === "k") {
          selected = (selected - 1 + options.length) % options.length;
        } else if (key === "\u001b[B" || key === "j") {
          selected = (selected + 1) % options.length;
        } else if (key === "\r" || key === "\n") {
          finish();
          return selected;
        } else if (key === ESCAPE || key === "q" || key === CTRL_C) {
          finish();
          return null;
        }
        draw();
      }
    } finally {
      process.stdout.write(SHOW_CURSOR);
    }
  });
}

export function createSecretTerminal(): SecretTerminal {
  requireTerminal();
  return {
    select: chooseOption,
    prompt: readSecret,
    print: (line) => console.info(line),
  };
}
