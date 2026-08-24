import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "../types";
import { HTTPException } from "hono/http-exception";
import { getAvailableCreditsBalance } from "../lib/polar";
import { logger } from "../lib/logger";

/**
 * Refuses a request that would cost money the customer does not have.
 *
 * The guard is only around the balance *lookup*. Wrapping `next()` too — as
 * this used to — turns every downstream failure into "Insufficient credits":
 * a database error, a bad request, a provider timeout, all reported to the
 * user as a billing problem and hidden from whoever is debugging it.
 *
 * A lookup that fails for a reason other than "no credits" fails open. Polar
 * being unreachable is our outage, not the customer's, and billing is metered
 * after the fact anyway — so the usage is still captured.
 */
export const requireCreditsBalance = createMiddleware<AuthEnv>(
  async (c, next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    try {
      const creditsBalance = await getAvailableCreditsBalance(userId);

      if (creditsBalance <= 0) {
        throw new HTTPException(402, {
          message: "Insufficient credits. Run /upgrade to buy more.",
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) throw error;

      logger.error("Credits balance lookup failed; allowing the request", {
        request_id: c.get("requestId"),
        error: String(error),
      });
    }

    await next();
  },
);
