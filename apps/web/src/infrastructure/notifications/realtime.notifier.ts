import { renderInvitationEmail, sendNotificationEmail } from "@match-maker/email";
import type { NotificationPort, NotificationTarget } from "../../application/ports/notification";

export class RealtimeNotifier implements NotificationPort {
  async invitation(input: { email: string; name: string | null; eventName: string; organizationName: string; eventUrl: string }): Promise<void> {
    await sendNotificationEmail({ to: input.email, ...renderInvitationEmail(input) });
  }

  introRequested(input: NotificationTarget): Promise<void> {
    return send(input, `${input.otherName} would like to meet at ${input.eventName}`, `${input.otherName} requested an introduction. Accept to share contact details.`, "Respond");
  }

  introAccepted(input: NotificationTarget): Promise<void> {
    return send(input, `${input.otherName} accepted your introduction`, `${input.otherName} accepted your introduction request. Their contact details are now on your Connections page.`, "See contact");
  }

  locationRequested(input: NotificationTarget): Promise<void> {
    return send(input, `${input.otherName} is asking where you are`, `${input.otherName} would like to find you at ${input.eventName}. Sharing your venue zone is up to you.`, "Reply");
  }

  locationAnswered(input: NotificationTarget & { zone: string | null }): Promise<void> {
    const text = input.zone ? `${input.otherName} is at ${input.zone}.` : `${input.otherName} would rather not share their location right now.`;
    return send(input, input.zone ? `${input.otherName} is at ${input.zone}` : `${input.otherName} replied to your location request`, text, "Open connections");
  }
}

async function send(input: NotificationTarget, subject: string, line: string, action: string): Promise<void> {
  const text = `Hi ${input.recipientName},\n\n${line}\n\n${action}: ${input.link}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#18181b"><h2>Mr. Bridge</h2>`
    + `<p>Hi ${escapeHtml(input.recipientName)},</p><p>${escapeHtml(line)}</p><p>Event: ${escapeHtml(input.eventName)}</p>`
    + `<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:12px 18px;background:#f59e0b;color:#0a0a0e;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a></p></div>`;
  await sendNotificationEmail({ to: input.recipientEmail, subject, text, html });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
