/** Join truthy class names. Accepts CSS-module lookups, which may be undefined. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
