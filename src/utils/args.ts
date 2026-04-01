/**
 * Parse a --flag <value> pair from an args array.
 * Returns the value after the flag, or undefined if the flag is not present.
 */
export function parseValue(args: string[], flag: string): string | undefined {
  const idx = args.findIndex((arg) => arg === flag);
  if (idx === -1) {
    return undefined;
  }
  return args[idx + 1];
}

/**
 * Check if a boolean --flag is present in the args array.
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
