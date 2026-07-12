// Elysia's `redirect(...)` context helper returns a raw `Response` object.
// That gets silently discarded (status reset to 200, Location/Set-Cookie
// headers dropped) whenever *any* hook in the route's pipeline references
// `cookie` in its handler signature — which for us is always true, since the
// global auth guard destructures `cookie` on every request. Use this instead
// of `redirect()` anywhere in this app.
export function redirectTo(
  set: { status?: unknown; headers: Record<string, unknown> },
  url: string
): string {
  set.status = 302;
  set.headers["Location"] = url;
  return "";
}
