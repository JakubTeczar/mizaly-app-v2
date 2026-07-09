import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { HttpError } from "../lib/httpError";
import { signAdminToken } from "../lib/jwt";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) {
      throw new HttpError(401, "Nieprawidłowy e-mail lub hasło.");
    }

    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatches) {
      throw new HttpError(401, "Nieprawidłowy e-mail lub hasło.");
    }

    const accessToken = signAdminToken({ sub: admin.id, isAdmin: true });

    res.json({ accessToken });
  })
);

export default router;
