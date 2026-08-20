import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "../types";
import { HTTPException } from "hono/http-exception";
import { getAvailableCreditsBalance } from "../lib/polar";

export const requireCreditsBalance = createMiddleware<AuthEnv>(
  async (c, next) => {
    try {
      const userId = c.get("userId");
      if (!userId) {
        throw new HTTPException(401, {
          message: "Unauthorized",
        });
      }
      const creditsBalance = await getAvailableCreditsBalance(userId);

      if (creditsBalance <= 0) {
        throw new HTTPException(402, {
          message: "Insufficient credits",
        });
      }
      await next();
    } catch (error) {
      throw new HTTPException(402, {
        message: "Insufficient credits",
      });
    }
  },
);
