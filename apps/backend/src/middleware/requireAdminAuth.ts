import { NextFunction, Request, Response } from "express";
import { verifyAdminToken } from "../lib/jwt";

export interface AuthenticatedAdmin {
  id: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

// Verifies the admin JWT (same secret as regular users, distinguished by the
// isAdmin claim) and attaches req.admin. A regular user's access token will
// fail here because it lacks `isAdmin: true`.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Brak autoryzacji." });
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAdminToken(token);
    if (!payload.isAdmin) {
      res.status(403).json({ error: "Brak uprawnień administratora." });
      return;
    }
    req.admin = { id: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: "Nieprawidłowy lub wygasły token." });
  }
}
