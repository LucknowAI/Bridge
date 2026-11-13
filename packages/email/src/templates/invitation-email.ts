/** The invitation an organizer sends to everyone on an event roster. */
export interface InvitationEmailInput {
  name: string | null;
  eventName: string;
  organizationName: string;
  /** The event page, where the attendee signs in and claims the invitation. */
  eventUrl: string;
}

export function renderInvitationEmail(input: InvitationEmailInput): { subject: string; html: string; text: string } {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const subject = `You're invited to ${input.eventName} on Mr. Bridge`;
  const text = [
    greeting,
    "",
    `${input.organizationName} added you to ${input.eventName}. Sign in with this e-mail address to claim your invitation, complete your profile, and see who you should meet.`,
    "",
    input.eventUrl,
    "",
    "If you did not expect this, you can ignore this e-mail.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;color:#18181b">
<h2>Mr. Bridge</h2>
<p>${escapeHtml(greeting)}</p>
<p><strong>${escapeHtml(input.organizationName)}</strong> added you to <strong>${escapeHtml(input.eventName)}</strong>. Sign in with this e-mail address to claim your invitation, complete your profile, and see who you should meet.</p>
<p><a href="${escapeHtml(input.eventUrl)}" style="display:inline-block;padding:12px 18px;background:#f59e0b;color:#0a0a0e;border-radius:8px;text-decoration:none;font-weight:bold">Claim your invitation</a></p>
<p style="color:#71717a;font-size:13px">If you did not expect this, you can ignore this e-mail.</p>
</div>`;
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
