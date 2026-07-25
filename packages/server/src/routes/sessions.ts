import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { findSupportedChatModel } from "@codepilot/shared";
import { db } from "@codepilot/database";
import { Role, Mode, MessageStatus } from "@codepilot/database/enums";

const createSessionSchema = z.object({
  title: z.string().min(1),
  cwd: z.string().optional(),
  initialMessage: z.object({
    role: z.enum(Role),
    content: z.string().min(1),
    mode: z.enum(Mode),
    model: z.string().refine((id) => !!findSupportedChatModel(id), {
      message: "Unsupported model",
    }),
  }),
});

const createSessionValidator = zValidator(
  "json",
  createSessionSchema,
  (result, c) => {
    if (!result.success) {
      return c.json({ message: "Invalid request body" }, 400);
    }
  },
);

const sessionsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const sessions = await db.session.findMany({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          title: true,
          cwd: true,
          createdAt: true,
        },
      });
      if (!sessions) {
        return c.json([], 200);
      }
      return c.json(sessions);
    } catch {
      throw new HTTPException(500, { message: "Failed to fetch sessions" });
    }
  })
  .get("/:id", async (c) => {
    try {
      const { id } = c.req.param();
      const session = await db.session.findUnique({
        where: {
          id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      });

      if (!session) {
        return c.json({ message: "Session not found" }, 404);
      }

      return c.json(session);
    } catch {
      throw new HTTPException(500, { message: "Failed to fetch session" });
    }
  })
  .post("/", createSessionValidator, async (c) => {
    try {
      const { initialMessage, ...data } = c.req.valid("json");
      const session = await db.session.create({
        data: {
          ...data,
          userId: "mock-user-id",
          ...(initialMessage && {
            messages: {
              create: {
                content: initialMessage.content,
                role: initialMessage.role,
                mode: initialMessage.mode,
                model: initialMessage.model,
                status: MessageStatus.COMPLETE,
              },
            },
          }),
        },
        include: {
          messages: true,
        },
      });

      if (!session) {
        return c.json({ message: "Failed to create session" }, 500);
      }
      return c.json(session, 201);
    } catch {
      throw new HTTPException(500, { message: "Failed to create session" });
    }
  });

export default sessionsRoutes;
