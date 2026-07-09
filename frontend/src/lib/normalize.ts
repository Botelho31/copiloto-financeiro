// Mirrors backend/src/jobs/recurringDetection.ts's normalizeDescription
// exactly, so grouping keys computed here line up with the server's rules.
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
