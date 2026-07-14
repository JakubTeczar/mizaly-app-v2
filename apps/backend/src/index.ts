import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import http from "http";
import { ZodError } from "zod";
import { HttpError } from "./lib/httpError";
import { createSocketServer } from "./socket";
import { startInspirationScrapeScheduler } from "./jobs/inspirationScrapeJob";
import { startYoutubeScrapeScheduler } from "./jobs/youtubeScrapeJob";
import { startNewsletterFetchScheduler } from "./jobs/newsletterFetchJob";
import { ensureDefaultWatchlists } from "./lib/watchlistSeed";

import authRouter from "./routes/auth";
import adminAuthRouter from "./routes/adminAuth";
import adminRouter from "./routes/admin";
import postsRouter from "./routes/posts";
import reelsRouter from "./routes/reels";
import websiteArticlesRouter from "./routes/websiteArticles";
import inspirationItemsRouter from "./routes/inspirationItems";
import inspirationRouter from "./routes/inspiration";
import instagramAccountsRouter from "./routes/instagramAccounts";
import youtubeChannelsRouter from "./routes/youtubeChannels";
import youtubeVideosRouter from "./routes/youtubeVideos";
import newslettersRouter from "./routes/newsletters";
import { conversationsRouter, messagesRouter } from "./routes/conversations";
import aiRouter from "./routes/ai";
import socialAccountsRouter from "./routes/socialAccounts";
import mediaRouter from "./routes/media";
import analyticsRouter from "./routes/analytics";
import mediaPreviewRouter from "./routes/mediaPreview";
import inspirationMediaRouter from "./routes/inspirationMedia";
import path from "path";
import { INSPIRATION_MEDIA_ROUTE } from "./lib/r2Store";

const app = express();

app.use(cors());
// Raised from the default 100kb - photo/video uploads arrive as base64 data
// URLs in the request body (see routes/media.ts), which are ~33% larger than
// the raw file.
app.use(express.json({ limit: "20mb" }));

// Scraped Instagram media (images + Reels) for the Inspiracje tab, re-hosted
// in Cloudflare R2 (see lib/r2Store.ts and jobs/inspirationScrapeJob.ts) -
// display-only, never sent to Zernio. The bucket is private, so this route
// proxies/streams objects out of R2 rather than serving a public URL.
app.use(INSPIRATION_MEDIA_ROUTE, inspirationMediaRouter);

// Fonts/logo used by the story template - served over HTTP only for the dev
// preview route below (/preview/story); the real render pipeline reads these
// files straight off disk via file:// (see media/storyTemplate.ts).
app.use("/media-assets", express.static(path.join(__dirname, "media", "assets")));
app.use("/preview", mediaPreviewRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin", adminRouter);
app.use("/api/posts", postsRouter);
app.use("/api/reels", reelsRouter);
app.use("/api/website-articles", websiteArticlesRouter);
app.use("/api/inspiration-items", inspirationItemsRouter);
app.use("/api/inspiration", inspirationRouter);
app.use("/api/instagram-accounts", instagramAccountsRouter);
app.use("/api/youtube-channels", youtubeChannelsRouter);
app.use("/api/youtube-videos", youtubeVideosRouter);
app.use("/api/newsletters", newslettersRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/ai", aiRouter);
app.use("/api/social-accounts", socialAccountsRouter);
app.use("/api/media", mediaRouter);
app.use("/api/analytics", analyticsRouter);

// Central error-handling middleware - route handlers throw HttpError (or let
// zod/prisma errors bubble up via asyncHandler) and this turns them into a
// consistent { error } JSON response.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: "Nieprawidłowe dane wejściowe.", details: err.issues });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Wystąpił nieoczekiwany błąd serwera." });
});

const httpServer = http.createServer(app);
const io = createSocketServer(httpServer);
app.set("io", io);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Mizaly backend listening on port ${PORT}`);
  ensureDefaultWatchlists()
    .catch((err) => console.error("[startup] Failed to seed default watch lists:", err))
    .finally(() => {
      startInspirationScrapeScheduler();
      startYoutubeScrapeScheduler();
      startNewsletterFetchScheduler();
    });
});
