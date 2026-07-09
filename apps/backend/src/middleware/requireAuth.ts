import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  role: string;
  zernioApiKeyId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// Verifies the `Authorization: Bearer <accessToken>` header and attaches
// req.user. Every organization-scoped route relies on req.user.organizationId
// to filter its queries - never trust an organizationId from the request body.
//
// zernioApiKeyId is looked up fresh from the DB on every request (rather than
// baked into the JWT) so an admin reassigning a user's Zernio API key takes
// effect immediately, without waiting for the access token to expire/refresh.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Brak autoryzacji." });
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { zernioApiKeyId: true },
    });
    req.user = {
      id: payload.sub,
      organizationId: payload.organizationId,
      role: payload.role,
      zernioApiKeyId: user?.zernioApiKeyId ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: "Nieprawidłowy lub wygasły token." });
  }
}
