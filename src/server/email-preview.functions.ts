import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { env } from "#/server/env";
import {
  getLatestSimulatedEmailId,
  getSimulatedEmailsSince,
  type SimulatedEmail,
} from "#/server/email";
import { resolveSessionUser } from "#/server/session";

const simulatedEmailsSchema = z.object({
  // null asks for the current cursor only, so a fresh page does not replay
  // emails that were sent before it was opened.
  afterId: z.number().int().min(0).nullable(),
});

export interface SimulatedEmailsResult {
  enabled: boolean;
  latestId: number;
  emails: SimulatedEmail[];
}

/**
 * Simulated (console-provider) emails addressed to the signed-in user. Always
 * empty outside local development, and only ever returns the caller's own
 * mail, because bodies can carry password-reset links.
 */
export const getSimulatedEmails = createServerFn({ method: "GET" })
  .inputValidator(simulatedEmailsSchema)
  .handler(async ({ data }): Promise<SimulatedEmailsResult> => {
    if (env.email.provider !== "console") {
      return { enabled: false, latestId: 0, emails: [] };
    }
    const user = await resolveSessionUser();
    if (!user?.email) {
      return { enabled: true, latestId: getLatestSimulatedEmailId(), emails: [] };
    }
    const latestId = getLatestSimulatedEmailId();
    const emails =
      data.afterId === null ? [] : getSimulatedEmailsSince(user.email, data.afterId);
    return { enabled: true, latestId, emails };
  });
