// Newsletter mailbox via IMAP (single fixed inbox, not per-tenant - see
// jobs/newsletterFetchJob.ts). Uses imapflow to talk to the mailbox and
// mailparser to decode the raw MIME source into HTML/text bodies.
//
// Envelopes are fetched first (cheap - no body download) so the job can skip
// re-downloading messages it already has by messageId; only new messages pay
// for a full source fetch + parse.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export function isMailConfigured(): boolean {
  return Boolean(process.env.MAIL_IMAP_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD);
}

function createClient(): ImapFlow {
  return new ImapFlow({
    host: process.env.MAIL_IMAP_HOST!,
    port: Number(process.env.MAIL_IMAP_PORT || 993),
    secure: true,
    // The mailbox's shared-hosting TLS cert is issued for the hosting
    // provider's own hostname, not this vanity domain, so strict hostname
    // verification always fails here - the connection is still encrypted,
    // just not hostname-pinned.
    tls: { rejectUnauthorized: false },
    auth: { user: process.env.MAIL_USER!, pass: process.env.MAIL_PASSWORD! },
    logger: false,
  });
}

export interface MailEnvelope {
  uid: number;
  messageId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
  date: Date;
}

export interface MailBody {
  bodyHtml: string | null;
  bodyText: string | null;
}

export async function listMailEnvelopes(): Promise<MailEnvelope[]> {
  const client = createClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const results: MailEnvelope[] = [];
      for await (const msg of client.fetch({ seq: "1:*" }, { envelope: true, uid: true })) {
        const envelope = msg.envelope;
        if (!envelope?.messageId) continue;
        results.push({
          uid: msg.uid,
          messageId: envelope.messageId,
          subject: envelope.subject || "(bez tematu)",
          fromName: envelope.from?.[0]?.name || null,
          fromAddress: envelope.from?.[0]?.address || null,
          date: envelope.date ?? new Date(),
        });
      }
      return results;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function fetchMailBody(uid: number): Promise<MailBody> {
  const client = createClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message || !message.source) {
        return { bodyHtml: null, bodyText: null };
      }
      const parsed = await simpleParser(message.source);
      return {
        bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
        bodyText: parsed.text ?? null,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
