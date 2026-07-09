import { io, type Socket } from "socket.io-client";
import { API_URL } from "./apiClient";

let socket: Socket | null = null;

/**
 * Lazily creates (or returns the existing) Socket.IO connection, authenticated
 * with the current access token. Call this only once the user is logged in.
 */
export function getSocket(token: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  if (socket) {
    socket.disconnect();
  }

  socket = io(API_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
