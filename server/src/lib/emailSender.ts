import { EmailClient } from '@azure/communication-email';
import { getEmailConfig } from '../config.js';

let client: EmailClient | undefined;

/** One budget for queuing AND confirmation. Below the workers' 300s process cap and
 * their 10-minute stale claim leases; does not alter worker backoff or SDK polling pace. */
export const EMAIL_SEND_TIMEOUT_MS = 60_000;

export class EmailSendTimeoutError extends Error {
  readonly code = 'EMAIL_SEND_TIMEOUT';
  constructor() {
    super(`ACS email send timed out after ${EMAIL_SEND_TIMEOUT_MS}ms; delivery outcome is unknown`);
    this.name = 'EmailSendTimeoutError';
  }
}

/** Lazily constructs the ACS EmailClient so importing this module never requires the
 *  email env vars to be set (only actually sending an email does). */
function getClient(): EmailClient {
  if (!client) {
    client = new EmailClient(getEmailConfig().connectionString);
  }
  return client;
}

export interface EmailAttachment {
  /** File name shown to the recipient, e.g. "wam-invite.ics". */
  name: string;
  /** MIME type of the attached content, e.g. "text/calendar; method=REQUEST". */
  contentType: string;
  /** Base64-encoded attachment content. */
  contentInBase64: string;
  /** CID used to render an inline attachment from the HTML body. */
  contentId?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  plainText: string;
  /** Optional ACS attachments, including the inline branded header and calendar ICS. */
  attachments?: EmailAttachment[];
}

/**
 * Sends a single email via Azure Communication Services Email and waits for a terminal
 * status. Throws on any non-"Succeeded" outcome (including "Failed"/"Canceled" or an
 * unexpected error from the SDK) — callers must never interpret a thrown error as a sent
 * email, and must not swallow it (see server/src/lib/wamReminders.ts).
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { senderAddress } = getEmailConfig();
  const message = {
    senderAddress,
    content: {
      subject: params.subject,
      html: params.html,
      plainText: params.plainText,
    },
    recipients: {
      to: [{ address: params.to }],
    },
    ...(params.attachments ? { attachments: params.attachments } : {}),
  };
  const controller = new AbortController();
  const timeoutError = new EmailSendTimeoutError();
  let poller: Awaited<ReturnType<EmailClient['beginSend']>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      controller.abort();
    }, EMAIL_SEND_TIMEOUT_MS);
  });
  try {
    const delivery = async () => {
      poller = await getClient().beginSend(message, { abortSignal: controller.signal });
      if (controller.signal.aborted) {
        poller.stopPolling();
        throw timeoutError;
      }
      const result = await poller.pollUntilDone({ abortSignal: controller.signal });
      if (result.status !== 'Succeeded') {
        const detail = result.error?.message ? `: ${result.error.message}` : '';
        throw new Error(`ACS email send did not succeed (status: ${result.status})${detail}`);
      }
    };
    // Cancellation stops SDK work; the race also releases the caller if an SDK promise
    // fails to honor cancellation. Aborting local polling cannot retract accepted mail:
    // a timeout remains an UNKNOWN outcome, retried by existing at-least-once policies.
    await Promise.race([delivery(), deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      try { poller?.stopPolling(); } catch { /* Preserve the explicit deadline error. */ }
    }
  }
}
