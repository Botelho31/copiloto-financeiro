// Every list/read route accepts an optional ?userId= query param: a specific
// person's id scopes the query to them, omitted means "Household" (every
// person combined) — see ARCHITECTURE.md's Household view. Every create/
// mutate route instead requires userId in the body, since data always
// belongs to exactly one person.
export function parseUserId(query: Record<string, unknown>): number | null {
  const raw = query.userId;
  if (raw == null || raw === "") return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}
