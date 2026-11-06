/** Turns a 2-letter region code into its flag emoji (regional indicators). */
export function flagEmoji(region: string): string {
  return String.fromCodePoint(
    ...[...region.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}
