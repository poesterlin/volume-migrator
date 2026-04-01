import * as readline from "readline";

/**
 * Reusable interactive CLI prompt helpers.
 * All functions use raw readline — zero dependencies.
 */

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask for free-text input.
 * Returns the trimmed answer, or `defaultValue` when the user presses Enter.
 */
export async function promptInput(
  message: string,
  defaultValue?: string,
): Promise<string> {
  const rl = createRl();
  const suffix = defaultValue ? ` (${defaultValue})` : "";

  return new Promise((resolve) => {
    rl.question(`${message}${suffix}: `, (answer) => {
      rl.close();
      const value = answer.trim();
      resolve(value || defaultValue || "");
    });
  });
}

/**
 * Ask a yes/no question.
 * Returns true for "y"/"yes", false for "n"/"no", or `defaultValue` on empty input.
 */
export async function promptConfirm(
  message: string,
  defaultValue = false,
): Promise<boolean> {
  const rl = createRl();
  const hint = defaultValue ? "Y/n" : "y/N";

  return new Promise((resolve) => {
    rl.question(`${message} [${hint}] `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultValue);
      else resolve(a === "y" || a === "yes");
    });
  });
}

/**
 * Present a numbered list and let the user pick one.
 * Returns the chosen item from `items`.
 *
 * Each item has a `label` (shown to the user) and a `value` (returned).
 * An optional `description` is shown after the label.
 */
export async function promptSelect<T>(
  message: string,
  items: { label: string; value: T; description?: string }[],
): Promise<T> {
  if (items.length === 0) {
    throw new Error("promptSelect called with empty items list");
  }

  console.log(`\n${message}`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const desc = item.description ? `  ${item.description}` : "";
    console.log(`  ${i + 1}) ${item.label}${desc}`);
  }

  const rl = createRl();

  return new Promise((resolve) => {
    const ask = (): void => {
      rl.question(`\nChoice [1-${items.length}]: `, (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (Number.isNaN(num) || num < 1 || num > items.length) {
          console.log(`  Please enter a number between 1 and ${items.length}.`);
          ask();
          return;
        }
        rl.close();
        resolve(items[num - 1]!.value);
      });
    };
    ask();
  });
}
