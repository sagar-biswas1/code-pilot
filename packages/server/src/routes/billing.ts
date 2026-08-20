import { Hono } from "hono";
import type { AuthEnv } from "../types";
import { createCheckoutUrl, createCustomerPortalUrl } from "../lib/polar";
import { requireAuth } from "../middleware/requireAuth";

const app = new Hono<AuthEnv>()
  .post("/checkout", requireAuth, async (c) => {
    const userId = c.get("userId");
    return c.json({
      url: await createCheckoutUrl({
        customerExternalID: userId,
        requestUrl: c.req.url,
      }),
    });
  })
  .post("/portal", requireAuth, async (c) => {
    const userId = c.get("userId");
    return c.json({
      url: await createCustomerPortalUrl({
        customerExternalID: userId,
        requestUrl: c.req.url,
      }),
    });
  })
  .get("/success", (c) => {
    return c.json({
      message: "Payment successful",
    });
  });

export default app;
