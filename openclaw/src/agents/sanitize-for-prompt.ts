/**
 * Sanitize untrusted strings before embedding them into an LLM prompt.
 *
 * Threat model (OC-19): attacker-controlled directory names (or other runtime strings)
 * that contain newline/control characters can break prompt structure and inject
 * arbitrary instructions.
 *
 * Strategy:
 * - Strip Unicode control (Cc) + format (Cf) characters (includes CR/LF/NUL, bidi marks).
 * - Strip explicit line/paragraph separators (Zl/Zp): U+2028/U+2029.
 */
export function sanitizeForPromptLiteral(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "");
}
