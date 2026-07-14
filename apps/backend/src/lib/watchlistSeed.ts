// One-time bootstrap so the Instagram/YouTube watch lists aren't empty on a
// fresh database - runs once at server startup (see index.ts) and is a no-op
// once an admin has edited either list via the Inspiracje tab.

import { prisma } from "./prisma";
import { DEFAULT_INSTAGRAM_ACCOUNTS } from "../integrations/instagramScraper";

const DEFAULT_YOUTUBE_CHANNELS = [
  { handle: "SzymonNegacz", displayName: "Szymon Negacz" },
  { handle: "KubaKlawiter", displayName: "Kuba Klawiter" },
  { handle: "IBMTechnology", displayName: "IBM Technology" },
];

export async function ensureDefaultWatchlists(): Promise<void> {
  const [instagramCount, youtubeCount] = await Promise.all([
    prisma.watchedInstagramAccount.count(),
    prisma.watchedYoutubeChannel.count(),
  ]);

  if (instagramCount === 0) {
    await prisma.watchedInstagramAccount.createMany({
      data: DEFAULT_INSTAGRAM_ACCOUNTS.map((username) => ({ username })),
      skipDuplicates: true,
    });
  }

  if (youtubeCount === 0) {
    await prisma.watchedYoutubeChannel.createMany({
      data: DEFAULT_YOUTUBE_CHANNELS,
      skipDuplicates: true,
    });
  }
}
