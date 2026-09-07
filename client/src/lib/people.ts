/**
 * The app-wide convention for naming a person in the UI: their chosen display name, falling
 * back to their email only when they never set one. Mirrors the server's own
 * `display_name?.trim() || email` rule so both sides label the same person identically.
 *
 * `personLabel` is what to render; `personSubtitle` is the email, returned only when it is
 * not already what is being rendered, so screens never print the same address twice.
 */
export function personLabel(person: { displayName?: string | null; email: string }): string {
  return person.displayName?.trim() || person.email;
}

export function personSubtitle(person: { displayName?: string | null; email: string }): string | null {
  return person.displayName?.trim() ? person.email : null;
}
