import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { html } from "@elysiajs/html";
import { Elysia } from "elysia";
import { authGuard } from "./auth/guard";
import { authRoutes } from "./auth/routes";
import { config } from "./config";
import "./db";
import { startDailySync } from "./jobs/dailySync";
import { accountsRoutes } from "./routes/accounts";
import { billsRoutes } from "./routes/bills";
import { categoriesRoutes } from "./routes/categories";
import { debtsRoutes } from "./routes/debts";
import { goalsRoutes } from "./routes/goals";
import { investmentsRoutes } from "./routes/investments";
import { notificationsRoutes } from "./routes/notifications";
import { projectionsRoutes } from "./routes/projections";
import { settingsRoutes } from "./routes/settings";
import { syncRoutes } from "./routes/sync";
import { tagsRoutes } from "./routes/tags";
import { transactionsRoutes } from "./routes/transactions";
import { usersRoutes } from "./routes/users";

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

startDailySync();

const app = new Elysia()
  .use(html())
  .get("/public/*", ({ params, set }) => serveFile(join(publicDir, params["*"]), set))
  .get("/api/health", () => ({ ok: true }))
  .use(authGuard)
  .use(authRoutes)
  .use(accountsRoutes)
  .use(billsRoutes)
  .use(categoriesRoutes)
  .use(debtsRoutes)
  .use(goalsRoutes)
  .use(investmentsRoutes)
  .use(notificationsRoutes)
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
  .listen(config.port);

console.log(`budget-tracker listening on http://localhost:${app.server?.port}`);
