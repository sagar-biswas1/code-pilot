import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { findSupportedChatModel } from "@codepilot/shared";

type MockMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  mode: string;
  model: string;
  status: "pending" | "completed" | "error";
  parts: null;
  duration: null;
  sessionId: string;
};

type MockSession = {
  id: string;
  title: string;
  cwd: string | null;
  userId: string;
  messages: MockMessage[];
  createdAt: Date;
};

const sessions: MockSession[] = [];
let nextId = 1;

const createSessionSchema = z.object({
  title: z.string().min(1),
  cwd: z.string().optional(),
  initialMessage: z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
    mode: z.string(),
    model: z
      .string()
      .refine((id) => !!findSupportedChatModel(id), {
        message: "Unsupported model",
      })
      .optional(),
  }),
});

const createSessionValidator = zValidator(
  "json",
  createSessionSchema,
  (result, c) => {
    if (!result.success) {
      return c.json({ message: "Invalid request body" }, 400);
    }
    return result.data;
  },
);

const app = new Hono().get("/", async (c) => {
  const result = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    createdAt: session.createdAt,
  }));
  return c.json(result);
}).get("/:id", async (c) => {
  const { id } = c.req.param();
  const session = sessions.find((session) => session.id === id);
  if (!session) {
    return c.json({ message: "Session not found" }, 404);
  }
  return c.json(session);
})
export default app;