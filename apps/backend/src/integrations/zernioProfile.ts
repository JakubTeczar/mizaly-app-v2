import { prisma } from "../lib/prisma";
import * as zernio from "./zernio";

// Zernio requires a "profile" to exist before connecting/listing/publishing
// to social accounts (see module comment in zernio.ts). We create one
// lazily, on first use, and cache the resulting id on the Organization row.
//
// The profile belongs to whichever apiKey created it - it's Zernio's own
// tenant space for that key. If an admin later reassigns the acting user to
// a different Zernio API key, this cached id no longer resolves under the
// new key (Zernio will 403/404), so the org's social accounts need to be
// reconnected. That's an accepted limitation of per-user key assignment for
// now, not handled automatically here.
export async function ensureZernioProfileId(organizationId: string, apiKey: string): Promise<string> {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (organization.zernioProfileId) {
    return organization.zernioProfileId;
  }

  const profile = await zernio.createProfile(apiKey, organization.name);
  await prisma.organization.update({ where: { id: organizationId }, data: { zernioProfileId: profile.id } });
  return profile.id;
}
