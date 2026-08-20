import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { isSupportedChatModel } from "../lib/models";
import { db } from "@codepilot/database/client";
import { Role, Mode, MessageStatus } from "@codepilot/database/enums";
import { logger } from "../lib/logger";
import { Sentry } from "../lib/sentry";
import { requireAuth } from "../middleware/requireAuth";
import type { AuthEnv } from "../types";

const createSessionSchema = z.object({
  title: z.string().min(1),
  cwd: z.string().optional(),
  initialMessage: z.object({
    role: z.enum(Role),
    content: z.string().min(1),
    mode: z.enum(Mode),
    // The server's own predicate, not the shared catalogue's: a model whose
    // provider has no SDK wired up would create a session that can never
    // generate a reply.
    model: z.string().refine(isSupportedChatModel, {
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

      // Error bodies are `{ error }` across every route so the CLI's
      // `getErrorMessage` has one field to read.
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

/**
 * Database calls are wrapped so the response stays generic, but the original
 * error is passed as `cause` — Sentry's linked-errors integration follows the
 * chain, so the Prisma stack trace still reaches the issue instead of being
 * replaced by a hand-written message.
 */
const sessionsRoutes = new Hono<AuthEnv>()
  // Mounted here rather than in `index.ts` so the guard and the `AuthEnv` type
  // that depends on it live in the same file — a route added below cannot end
  // up unprotected while still reading `c.get("userId")`.
  .use(requireAuth)
  .get("/", async (c) => {
    const userId = c.get("userId");

    try {
      const sessions = await db.session.findMany({
        where: {
          userId,
        },
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
    const userId = c.get("userId");

    try {
      // `findFirst` rather than `findUnique`, because the id alone is no
      // longer enough: someone else's session has to come back as "not found",
      // not as a 403 that confirms the id exists.
      const session = await db.session.findFirst({
        where: {
          id,
          userId,
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
          operation: "session.findFirst",
          session_id: id,
        });
        return c.json({ error: "Session not found" }, 404);
      }

      logger.debug("Fetched session", {
        request_id: c.get("requestId"),
        operation: "session.findFirst",
        session_id: id,
        message_count: session.messages.length,
      });

      return c.json(session);
    } catch (error) {
      logger.error("Failed to fetch session", {
        request_id: c.get("requestId"),
        operation: "session.findFirst",
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
    const userId = c.get("userId");

    try {
      // `initialMessage` is required by the schema, so it is always present
      // here — no conditional spread needed.
      const session = await db.session.create({
        data: {
          ...data,
          userId,
          messages: {
            create: {
              content: initialMessage.content,
              role: initialMessage.role,
              mode: initialMessage.mode,
              model: initialMessage.model,
              status: MessageStatus.COMPLETE,
            },
          },
        },
        include: {
          messages: true,
        },
      });

      logger.info("Created session", {
        request_id: c.get("requestId"),
        session_id: session.id,
        model: initialMessage.model,
        mode: initialMessage.mode,
      });

      return c.json(session, 201);
    } catch (error) {
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
