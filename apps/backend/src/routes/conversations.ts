import { Router } from "express";
import { z } from "zod";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { requireAuth } from "../middleware/requireAuth";
import { emitNewMessage } from "../socket";

export const conversationsRouter = Router();
export const messagesRouter = Router();

conversationsRouter.use(requireAuth);
messagesRouter.use(requireAuth);

conversationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversations = await prisma.conversation.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { lastMessageAt: "desc" },
    });
    res.json(conversations);
  })
);

conversationsRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!conversation) {
      throw new HttpError(404, "Nie znaleziono konwersacji.");
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    res.json(messages);
  })
);

const createMessageSchema = z.object({
  body: z.string().min(1),
});

// POST /api/messages/:conversationId - mounted separately in index.ts since
// it lives outside the /api/conversations resource path.
messagesRouter.post(
  "/:conversationId",
  asyncHandler(async (req, res) => {
    const { body } = createMessageSchema.parse(req.body);

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.conversationId, organizationId: req.user!.organizationId },
    });
    if (!conversation) {
      throw new HttpError(404, "Nie znaleziono konwersacji.");
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "outbound",
        body,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const io = req.app.get("io") as SocketIOServer | undefined;
    if (io) {
      emitNewMessage(io, conversation.organizationId, message);
    }

    res.status(201).json(message);
  })
);
