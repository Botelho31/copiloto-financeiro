import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import { config } from "./config";
import { isUnlocked } from "./db";
import { accountsRoutes } from "./routes/accounts";
import { appConfigRoutes } from "./routes/appConfig";
import { billsRoutes } from "./routes/bills";
import { categoriesRoutes } from "./routes/categories";
import { debtsRoutes } from "./routes/debts";
import { goalsRoutes } from "./routes/goals";
import { investmentsRoutes } from "./routes/investments";
import { projectionsRoutes } from "./routes/projections";
import { settingsRoutes } from "./routes/settings";
import { syncRoutes } from "./routes/sync";
import { tagsRoutes } from "./routes/tags";
import { transactionsRoutes } from "./routes/transactions";
import { usersRoutes } from "./routes/users";
import { isValidApiKey, isValidSession, SESSION_COOKIE_NAME, vaultRoutes } from "./routes/vault";

const backendDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(backendDir, "../public");
const frontendDistDir = join(backendDir, "../../frontend/dist");

async function serveFile(path: string, set: { status?: unknown }) {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    set.status = 404;
    return "Not found";
  }
  return file;
}

// Same shape as the single-admin authGuard this app had before dropping
// accounts entirely in favor of encrypting the database itself (see
// ARCHITECTURE.md) — a global onBeforeHandle, checked on every request.
// `/api/vault/*` must stay reachable regardless of lock state (status/setup/
// unlock themselves), and the SPA shell is always served either way — the
// React app itself renders the locked/setup/unlock screen by calling
// GET /api/vault/status on load, not a server redirect.
const lockGate = new Elysia().onBeforeHandle(
  { as: "global" },
  async ({ path, headers, cookie, set }) => {
    if (path.startsWith("/api/vault/") || path === "/api/health" || path.startsWith("/public/")) {
      return;
    }
    if (!path.startsWith("/api/")) return;

    if (!isUnlocked()) {
      set.status = 423;
      return { error: "Vault is locked" };
    }

    const sessionCookie = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    if (isValidSession(sessionCookie)) return;

    const apiKey = headers["x-api-key"];
    if (await isValidApiKey(apiKey)) return;

    set.status = 401;
    return { error: "Missing or invalid credentials" };
  }
);

const app = new Elysia()
  .get("/public/*", ({ params, set }) => serveFile(join(publicDir, params["*"]), set))
  .get("/api/health", () => ({ ok: true }))
  .use(lockGate)
  .use(vaultRoutes)
  .use(accountsRoutes)
  .use(appConfigRoutes)
  .use(billsRoutes)
  .use(categoriesRoutes)
  .use(debtsRoutes)
  .use(goalsRoutes)
  .use(investmentsRoutes)
  .use(projectionsRoutes)
  .use(settingsRoutes)
  .use(syncRoutes)
  .use(tagsRoutes)
  .use(transactionsRoutes)
  .use(usersRoutes)
  .get("/assets/*", ({ params, set }) =>
    serveFile(join(frontendDistDir, "assets", params["*"]), set)
  )
  .get("/*", ({ set }) => serveFile(join(frontendDistDir, "index.html"), set))
  .listen({ port: config.port, hostname: config.host });

console.log(`budget-tracker listening on http://${config.host}:${app.server?.port}`);
