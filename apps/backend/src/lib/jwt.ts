import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: string;
}

export interface RefreshTokenPayload {
  sub: string;
  organizationId: string;
}

export interface AdminTokenPayload {
  sub: string;
  isAdmin: true;
}

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "30d";
const ADMIN_TOKEN_EXPIRY = "12h";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured.");
  }
  return secret;
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error("JWT_REFRESH_SECRET is not configured.");
  }
  return secret;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, getJwtRefreshSecret(), { expiresIn: REFRESH_TOKEN_EXPIRY });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, getJwtSecret()) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, getJwtRefreshSecret()) as RefreshTokenPayload;
}

// Admin tokens reuse JWT_SECRET (same signing secret as regular access tokens)
// but are distinguished by the `isAdmin: true` claim, checked explicitly by
// requireAdminAuth so a regular user token can never pass as an admin token.
export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ADMIN_TOKEN_EXPIRY });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  return jwt.verify(token, getJwtSecret()) as AdminTokenPayload;
}
