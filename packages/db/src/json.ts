export function encodeJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function decodeJson(value: string | null): unknown | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function decodeStringArray(value: string): string[] {
  const decoded = decodeJson(value);
  return Array.isArray(decoded) && decoded.every((item) => typeof item === 'string')
    ? decoded
    : [];
}
