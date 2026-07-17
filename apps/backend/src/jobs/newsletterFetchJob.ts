// Background job: periodically checks the shared newsletter mailbox (see
// src/integrations/mail.ts) for messages not yet stored, downloads and parses
// only those, and stores them in NewsletterEmail. Read-only mailbox access -
// nothing is ever deleted or marked read on the server.

import { prisma } from "../lib/prisma";
import { fetchMailBodies, isMailConfigured, listMailEnvelopes } from "../integrations/mail";
import { generateNewsletterInsights } from "../lib/contentInsights";

const CHECK_EVERY_MS = 60 * 60 * 1000;

let isRunning = false;

export async function runNewsletterFetchJob(): Promise<void> {
  if (isRunning) return;
  if (!isMailConfigured()) {
    console.warn("[newsletter-job] MAIL_* env vars missing - skipping fetch.");
    return;
  }

  isRunning = true;
  console.log("[newsletter-job] Checking mailbox for new newsletters...");
  try {
    const envelopes = await listMailEnvelopes();
    const existingIds = new Set(
      (await prisma.newsletterEmail.findMany({ select: { messageId: true } })).map((e) => e.messageId)
    );

    const newEnvelopes = envelopes.filter((e) => !existingIds.has(e.messageId));
    const bodies = await fetchMailBodies(newEnvelopes.map((e) => e.uid));

    let stored = 0;
    for (const envelope of newEnvelopes) {
      const body = bodies.get(envelope.uid);
      if (!body) {
        console.error(`[newsletter-job] No body fetched for message ${envelope.messageId} (uid ${envelope.uid}).`);
        continue;
      }
      try {
        await prisma.newsletterEmail.create({
          data: {
            messageId: envelope.messageId,
            subject: envelope.subject,
            fromName: envelope.fromName,
            fromAddress: envelope.fromAddress,
            receivedAt: envelope.date,
            bodyHtml: body.bodyHtml,
            bodyText: body.bodyText,
          },
        });
        stored++;
      } catch (err) {
        console.error(`[newsletter-job] Failed to store message ${envelope.messageId}:`, err);
      }
    }
    console.log(`[newsletter-job] Stored ${stored} new newsletter(s).`);

    if (stored > 0) {
      try {
        await generateNewsletterInsights();
      } catch (err) {
        console.error("[newsletter-job] AI insights generation failed:", err);
      }
    }
  } catch (err) {
    console.error("[newsletter-job] Fetch failed:", err);
  } finally {
    isRunning = false;
  }
}

export function startNewsletterFetchScheduler(): void {
  setTimeout(() => {
    runNewsletterFetchJob().catch((err) => console.error("[newsletter-job] Initial fetch failed:", err));
  }, 20_000);

  setInterval(() => {
    runNewsletterFetchJob().catch((err) => console.error("[newsletter-job] Periodic fetch failed:", err));
  }, CHECK_EVERY_MS);
}
