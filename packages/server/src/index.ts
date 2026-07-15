import { Hono } from "hono";

import { HTTPException } from "hono/http-exception";

const app =new Hono()


app.onError((err, c) => {
    if (err instanceof HTTPException) {
        return err.getResponse();
    }
    return c.json({ message: "Internal Server Error" }, 500);
});

export default {
    port: 3000,
    fetch: app.fetch,
    //idletime must be high, otherwise llm tool call might not be completed
    idleTimeout: 255,
};