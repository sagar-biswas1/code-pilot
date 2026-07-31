import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { findSupportedChatModel } from "@codepilot/shared";
import { db } from "@codepilot/database/client";
import { Role, Mode, MessageStatus } from "@codepilot/database/enums";
import { logger } from "../lib/logger";
import { Sentry } from "../lib/sentry";
import type { AppEnv } from "../types";

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
      // A rejected body is the client's problem, not an issue to page on. Both
      // the breadcrumb and the log land on the request's Sentry scope, which
      // already carries the request id, so they stay correlated.
      const fields = result.error.issues.map((issue) => issue.path.join("."));

      Sentry.addBreadcrumb({
        category: "validation",
        level: "warning",
        message: "Invalid create-session body",
        data: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          })),
        },
      });

      logger.warn("Rejected invalid create-session body", {
        issue_count: result.error.issues.length,
        fields,
      });

      return c.json({ message: "Invalid request body" }, 400);
    }
  },
);

/**
 * Database calls are wrapped so the response stays generic, but the original
 * error is passed as `cause` — Sentry's linked-errors integration follows the
 * chain, so the Prisma stack trace still reaches the issue instead of being
 * replaced by a hand-written message.
 */
const sessionsRoutes = new Hono<AppEnv>()
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

      logger.debug("Listed sessions", {
        request_id: c.get("requestId"),
        operation: "session.findMany",
        session_count: sessions.length,
      });

      return c.json(sessions);
    } catch (error) {
      logger.error("Failed to fetch sessions", {
        request_id: c.get("requestId"),
        operation: "session.findMany",
        error: String(error),
      });
      throw new HTTPException(500, {
        message: "Failed to fetch sessions",
        cause: error,
      });
    }
  })
  .get("/:id", async (c) => {
    const { id } = c.req.param();

    try {
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
        // A missing id is a client mistake, so this stays a warning rather than
        // an error — the 404 handler in `index.ts` only sees unmatched routes.
        logger.warn("Session not found", {
          request_id: c.get("requestId"),
          operation: "session.findUnique",
          session_id: id,
        });
        return c.json({ message: "Session not found" }, 404);
      }

      logger.debug("Fetched session", {
        request_id: c.get("requestId"),
        operation: "session.findUnique",
        session_id: id,
        message_count: session.messages.length,
      });

      return c.json(session);
    } catch (error) {
      logger.error("Failed to fetch session", {
        request_id: c.get("requestId"),
        operation: "session.findUnique",
        session_id: id,
        error: String(error),
      });
      throw new HTTPException(500, {
        message: "Failed to fetch session",
        cause: error,
      });
    }
  })
  .post("/", createSessionValidator, async (c) => {
    const { initialMessage, ...data } = c.req.valid("json");

    try {
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
        logger.error("Session create returned no row", {
          request_id: c.get("requestId"),
          operation: "session.create",
        });
        throw new HTTPException(500, { message: "Failed to create session" });
      }

      logger.info("Created session", {
        request_id: c.get("requestId"),
        session_id: session.id,
        model: initialMessage.model,
        mode: initialMessage.mode,
      });

      return c.json(session, 201);
    } catch (error) {
      // Already shaped for the client (and already logged upstream) — let it through.
      if (error instanceof HTTPException) {
        throw error;
      }

      logger.error("Failed to create session", {
        request_id: c.get("requestId"),
        operation: "session.create",
        error: String(error),
      });
      throw new HTTPException(500, {
        message: "Failed to create session",
        cause: error,
      });
    }
  });

export default sessionsRoutes;
