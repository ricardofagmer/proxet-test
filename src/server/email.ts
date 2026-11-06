import { env } from "#/server/env";

//
// Minimal provider abstraction for transactional email. Three modes, chosen
// once at startup by src/server/env.ts:
//   - "console": logs the message to stdout (development default)
//   - "test":    captures messages in memory for E2E assertions (TEST_MODE)
//   - "resend":  sends via the Resend HTTP API
// Handlers must never depend on which mode is active.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

// In-memory capture for TEST_MODE — read back by the /test-emails route so
// E2E tests can extract verification/reset links.
const capturedEmails: EmailMessage[] = [];

export function getCapturedEmails(to?: string): EmailMessage[] {
  return to ? capturedEmails.filter((e) => e.to === to) : [...capturedEmails];
}

export interface SimulatedEmail extends EmailMessage {
  id: number;
  sentAt: string;
}

// Dev-only outbox for the "console" provider, so the signed-in user can see
// simulated emails in the UI instead of digging through the server log.
// Bounded so a long dev session cannot grow it without limit.
const SIMULATED_OUTBOX_LIMIT = 100;
const simulatedOutbox: SimulatedEmail[] = [];
let nextSimulatedEmailId = 1;

function recordSimulatedEmail(message: EmailMessage): void {
  simulatedOutbox.push({
    ...message,
    id: nextSimulatedEmailId++,
    sentAt: new Date().toISOString(),
  });
  if (simulatedOutbox.length > SIMULATED_OUTBOX_LIMIT) simulatedOutbox.shift();
}

/** Id of the newest simulated email (0 when none), used as a polling cursor. */
export function getLatestSimulatedEmailId(): number {
  return nextSimulatedEmailId - 1;
}

export function getSimulatedEmailsSince(to: string, afterId: number): SimulatedEmail[] {
  return simulatedOutbox.filter((email) => email.to === to && email.id > afterId);
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  switch (env.email.provider) {
    case "test":
      capturedEmails.push(message);
      return;
    case "console":
      recordSimulatedEmail(message);
      // Deliberately raw console output, not the structured logger: printing
      // the full body (with its verification/reset link) to the dev terminal
      // IS the delivery mechanism for this provider, and it never runs in
      // production.
      console.log(
        `[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`,
      );
      return;
    case "resend": {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.email.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.email.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Resend API error ${response.status}: ${body.slice(0, 500)}`,
        );
      }
      return;
    }
  }
}
