import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";

const router = Router();

const registerSchema = z.object({
  organizationName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

function toPublicUser(user: { id: string; organizationId: string; email: string; role: string; createdAt: Date }) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { organizationName, email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "Użytkownik z tym adresem e-mail już istnieje.");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const organization = await prisma.organization.create({
      data: { name: organizationName },
    });

    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email,
        passwordHash,
        role: "owner",
      },
    });

    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, organizationId: user.organizationId });

    res.status(201).json({ accessToken, refreshToken, user: toPublicUser(user) });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(401, "Nieprawidłowy e-mail lub hasło.");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new HttpError(401, "Nieprawidłowy e-mail lub hasło.");
    }

    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, organizationId: user.organizationId });

    res.json({ accessToken, refreshToken, user: toPublicUser(user) });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, "Nieprawidłowy lub wygasły refresh token.");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new HttpError(401, "Użytkownik nie istnieje.");
    }

    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, role: user.role });

    res.json({ accessToken });
  })
);

export default router;
