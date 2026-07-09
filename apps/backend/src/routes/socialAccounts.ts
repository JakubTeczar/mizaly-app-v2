import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { HttpError } from "../lib/httpError";
import * as zernio from "../integrations/zernio";
import { storePendingConnection, consumePendingConnection } from "../integrations/pendingConnections";
import { ensureZernioProfileId } from "../integrations/zernioProfile";
import { resolveZernioApiKey } from "../integrations/zernioApiKeys";

const router = Router();

const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");
const MOBILE_APP_URL = (process.env.MOBILE_APP_URL || "http://localhost:5173").replace(/\/$/, "");

// Never selects accessToken/refreshToken - those are internal, not for the
// client, even though we don't currently populate them (Zernio keeps
// platform tokens on its own side; see module comment in zernio.ts).
const PUBLIC_ACCOUNT_FIELDS = {
  id: true,
  organizationId: true,
  platform: true,
  zernioAccountId: true,
  displayName: true,
  connectedAt: true,
} as const;

async function upsertLocalAccount(organizationId: string, mapped: { zernioAccountId: string; platform: string; displayName: string }) {
  return prisma.socialAccount.upsert({
    where: { organizationId_zernioAccountId: { organizationId, zernioAccountId: mapped.zernioAccountId } },
    update: { displayName: mapped.displayName, platform: mapped.platform as any },
    create: {
      organizationId,
      zernioAccountId: mapped.zernioAccountId,
      platform: mapped.platform as any,
      displayName: mapped.displayName,
    },
    select: PUBLIC_ACCOUNT_FIELDS,
  });
}

// Lets the frontend build its "connect a platform" UI without hardcoding a
// second copy of which platforms actually support the OAuth connect flow.
router.get(
  "/platforms",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ platforms: zernio.OAUTH_CONNECTABLE_PLATFORMS });
  })
);

// Live-lists accounts from Zernio and mirrors them into the local table (used
// elsewhere, e.g. to pick target platforms when composing a post). Falls
// back to the local cache if Zernio isn't configured yet.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);

    if (!apiKey) {
      const local = await prisma.socialAccount.findMany({
        where: { organizationId },
        orderBy: { connectedAt: "desc" },
        select: PUBLIC_ACCOUNT_FIELDS,
      });
      return res.json(local);
    }

    const zernioProfileId = await ensureZernioProfileId(organizationId, apiKey);
    const remote = await zernio.listAccounts(apiKey, zernioProfileId);
    const saved = await Promise.all(remote.map((account) => upsertLocalAccount(organizationId, zernio.mapZernioAccount(account))));
    res.json(saved);
  })
);

// Kicks off the Zernio "connect a social account" flow: asks Zernio for a
// platform authorization URL and hands it back to the frontend to redirect
// the browser to. We tag our own redirect_url with a `cid` (correlation id)
// so /callback below can figure out which organization/platform this was for
// once the browser comes back - see the module comment in
// src/integrations/zernio.ts for why we can't rely on Zernio's own `state`.
router.post(
  "/connect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const platform = String(req.body?.platform || "");
    if (!platform) {
      throw new HttpError(400, "Brak pola 'platform'.");
    }

    const organizationId = req.user!.organizationId;
    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);
    if (!apiKey) {
      throw new HttpError(503, "Zernio nie jest skonfigurowane dla tego użytkownika.");
    }

    const zernioProfileId = await ensureZernioProfileId(organizationId, apiKey);
    const cid = randomUUID();
    const redirectUrl = `${BACKEND_PUBLIC_URL}/api/social-accounts/callback?cid=${cid}`;
    const { authUrl } = await zernio.initiateConnect(apiKey, platform, zernioProfileId, redirectUrl);
    storePendingConnection(cid, { organizationId, zernioProfileId, platform, apiKey });
    res.json({ authUrl });
  })
);

// Public route - this is where the end user's browser lands after Zernio has
// already finished connecting the account on its own side (see
// src/integrations/zernio.ts). No auth header is available here, so we
// recover the organization from the `cid` we tagged onto redirect_url in
// /connect above, then just re-sync the account list to pick up what's new.
router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const cid = typeof req.query.cid === "string" ? req.query.cid : "";
    const pending = cid ? consumePendingConnection(cid) : null;

    if (!pending) {
      return res.redirect(`${MOBILE_APP_URL}/konta?connected=0&error=invalid_state`);
    }

    try {
      const remote = await zernio.listAccounts(pending.apiKey, pending.zernioProfileId);
      await Promise.all(remote.map((account) => upsertLocalAccount(pending.organizationId, zernio.mapZernioAccount(account))));
      res.redirect(`${MOBILE_APP_URL}/konta?connected=1&platform=${encodeURIComponent(pending.platform)}`);
    } catch (err) {
      console.error("Zernio connect callback sync failed:", err);
      res.redirect(`${MOBILE_APP_URL}/konta?connected=0&error=sync_failed`);
    }
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const account = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!account) {
      throw new HttpError(404, "Nie znaleziono konta.");
    }

    const apiKey = resolveZernioApiKey(req.user!.zernioApiKeyId);
    if (apiKey) {
      try {
        await zernio.deleteAccount(apiKey, account.zernioAccountId);
      } catch (err) {
        console.error("Zernio delete-account failed, removing local record anyway:", err);
      }
    }

    await prisma.socialAccount.delete({ where: { id: account.id } });
    res.status(204).end();
  })
);

export default router;
