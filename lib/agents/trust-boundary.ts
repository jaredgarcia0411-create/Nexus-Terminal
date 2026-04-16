/**
 * Trust boundary helpers for LLM prompt assembly.
 *
 * Anthropic's XML-delimiter convention uses named tags to signal trust level
 * to the model. These helpers enforce a consistent labeling contract across
 * all blueprints and prevent delimiter-injection from untrusted content.
 *
 * Usage:
 *   - wrapTrusted()  — for system-prompt text and hardcoded instructions
 *   - wrapUntrusted() — for anything that originates outside the codebase:
 *       user messages, conversation history, memory, news, filings, external APIs
 *
 * The model reads the labels as hints; content is still fully visible to it.
 * sanitize() is called automatically inside wrapUntrusted() — do not call it
 * separately unless you have a specific reason to do so.
 */

/**
 * Regex that matches any opening or closing trust-boundary delimiter tag,
 * case-insensitive, including both the trusted and untrusted families.
 *
 * Matches:
 *   <untrusted-foo>   </untrusted-foo>
 *   <trusted-bar>     </trusted-bar>
 *   <UNTRUSTED-X>     </TRUSTED-X>
 */
const DELIMITER_RE = /<\/?(trusted|untrusted)-[^>]*>/gi;

/**
 * Strip delimiter tags from untrusted content so a hostile payload cannot
 * escape its wrapper or forge a trusted context. Replaced with a visible
 * marker so the model still sees that something was there.
 */
export function sanitize(content: string): string {
  return content.replace(DELIMITER_RE, '[tag-stripped]');
}

/**
 * Wrap a string of untrusted content in an XML delimiter pair.
 * sanitize() is run on the content before wrapping.
 *
 * @param label  Short origin name, e.g. "user-message", "news", "filing"
 * @param content  The raw untrusted string to fence
 */
export function wrapUntrusted(label: string, content: string): string {
  const safe = sanitize(content);
  return `<untrusted-${label}>\n${safe}\n</untrusted-${label}>`;
}

/**
 * Wrap a string of trusted content in an XML delimiter pair.
 * No sanitization is performed — trusted content is assumed safe by definition.
 *
 * @param label  Short descriptor, e.g. "system-instructions", "schema"
 * @param content  The trusted string to fence
 */
export function wrapTrusted(label: string, content: string): string {
  return `<trusted-${label}>\n${content}\n</trusted-${label}>`;
}
