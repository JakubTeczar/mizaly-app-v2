import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { verifyAccessToken } from "./lib/jwt";

// One Socket.IO room per organization (see ROADMAP.md section 3). Clients
// connect with their JWT access token in the handshake auth payload:
//   io("http://localhost:4000", { auth: { token: accessToken } })
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
    },
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("Brak autoryzacji."));
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.organizationId = payload.organizationId;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Nieprawidłowy lub wygasły token."));
    }
  });

  io.on("connection", (socket: Socket) => {
    const organizationId = socket.data.organizationId as string;
    socket.join(organizationId);
  });

  return io;
}

// Emits a new message event to every client connected to the given
// organization's room. Called after a Message row is created.
export function emitNewMessage(io: SocketIOServer, organizationId: string, message: unknown) {
  io.to(organizationId).emit("new-message", message);
}
