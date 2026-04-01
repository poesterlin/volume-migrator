type JsonRecord = Record<string, unknown>;

export function padRight(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

export function toJson(value: JsonRecord): string {
  return JSON.stringify(value, null, 2);
}
