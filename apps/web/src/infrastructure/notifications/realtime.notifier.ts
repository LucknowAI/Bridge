import { renderInvitationEmail, sendNotificationEmail } from "@match-maker/email";
import type { NotificationPort } from "../../application/ports/notification";

export class RealtimeNotifier implements NotificationPort {
  async invitation(input: { email: string; name: string | null; eventName: string; organizationName: string; eventUrl: string }): Promise<void> {
    await sendNotificationEmail({ to: input.email, ...renderInvitationEmail(input) });
  }

  async introRequested(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; introId: string }): Promise<void> {
    const subject = `${input.requesterName} would like to meet at ${input.eventName}`;
    const text = `Hi ${input.recipientName},\n\n${input.requesterName} requested an introduction at ${input.eventName}. Sign in to Mr. Bridge to respond.`;
    await sendNotificationEmail({ to: input.recipientEmail, subject, text, html: emailHtml(input.recipientName, input.requesterName, input.eventName, "requested an introduction. Sign in to Mr. Bridge to respond.") });
  }

  async introResponded(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; accepted: boolean }): Promise<void> {
    const status = input.accepted ? "accepted" : "declined";
    const subject = `Your introduction request was ${status}`;
    const text = `Hi ${input.recipientName},\n\n${input.requesterName} ${status} your introduction request for ${input.eventName}.`;
    await sendNotificationEmail({ to: input.recipientEmail, subject, text, html: emailHtml(input.recipientName, input.requesterName, input.eventName, `${status} your introduction request.`) });
  }
}

function emailHtml(name: string, otherPerson: string, event: string, action: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#18181b"><h2>Mr. Bridge</h2><p>Hi ${escapeHtml(name)},</p><p><strong>${escapeHtml(otherPerson)}</strong> ${escapeHtml(action)}</p><p>Event: ${escapeHtml(event)}</p><p>Open Mr. Bridge to view your connections.</p></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
