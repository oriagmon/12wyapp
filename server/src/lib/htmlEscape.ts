/** Escapes the five HTML-significant characters — always use this before interpolating any
 *  user-controlled (or otherwise dynamic) string into an HTML email body, to prevent markup
 *  injection regardless of what the value contains. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
