// Everything else that used to live here (Pluggy bootstrap credentials, cron
// schedule, and — before this app dropped auth entirely for local-only use —
// the session secret) is now DB-backed and editable from /config — see
// services/appConfig.ts. These three stay in .env since they're needed
// before the DB is even readable.
export const config = {
  port: Number(process.env.PORT ?? "3000"),
  // Loopback-only by default — this app has no login, so "unlocked" must mean
  // "reachable from this machine," not "reachable from anyone on the LAN."
  // Binding wide open (0.0.0.0) is an explicit opt-in, not the default, same
  // reasoning as the README's "use Tailscale, don't port-forward this" stance.
  host: process.env.HOST ?? "127.0.0.1",
  dbPath: process.env.DB_PATH ?? "./data/budget.sqlite",
};
