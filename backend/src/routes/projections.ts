import { Elysia } from "elysia";
import { computeProjection, type BillOverride } from "../services/projectionEngine";

export const projectionsRoutes = new Elysia({ prefix: "/api/projections" })
  .get("/", ({ query }) => {
    const horizonMonths = query.horizonMonths ? Number(query.horizonMonths) : undefined;
    return computeProjection({ horizonMonths });
  })
  .post("/what-if", ({ body }) => {
    const input = body as {
      horizonMonths?: number;
      billOverrides?: BillOverride[];
      discretionaryDeltaPercent?: number;
      interestRateAnnualPercent?: number;
      cardSpendGoal?: number;
    };
    return computeProjection(input);
  });
