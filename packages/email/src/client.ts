import { Resend } from "resend";
import { renderLoginEmail, type LoginEmailInput } from "./templates/login-email";

let client: Resend | null = null;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Resend(apiKey);
  return client;
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM || "Mr. Bridge <onboarding@resend.dev>";
}

export interface SendResult {
  /** False when the message was logged locally instead of actually sent. */
  delivered: boolean;
  id: string | null;
}

/**
 * Send the login e-mail carrying the code and the magic link.
 *
 * With no RESEND_API_KEY configured, the message is printed to the server log
 * instead — but only when EMAIL_DEV_FALLBACK is explicitly enabled. That keeps
 * `docker compose up` usable without a Resend account, while making it
 * impossible to deploy something that silently fails to deliver logins.
 *
 * The opt-in is a dedicated flag rather than a NODE_ENV check because a
 * container is built with NODE_ENV=production everywhere, local included.
 */
export async function sendLoginEmail(
  to: string,
  input: LoginEmailInput
): Promise<SendResult> {
  const { subject, html, text } = renderLoginEmail(input);
  const resend = getClient();

  if (!resend) {
    if (process.env.EMAIL_DEV_FALLBACK !== "true") {
      throw new Error(
        "RESEND_API_KEY is not set. Refusing to start a login flow that cannot " +
          "deliver its e-mail. Set EMAIL_DEV_FALLBACK=true to log it instead (local only)."
      );
    }
    console.warn(
      [
        "",
        "─".repeat(64),
        "  RESEND_API_KEY not set — login e-mail NOT sent.",
        `  To:    ${to}`,
        `  Code:  ${input.code}`,
        `  Link:  ${input.magicLinkUrl}`,
        "─".repeat(64),
        "",
      ].join("\n")
    );
    return { delivered: false, id: null };
  }

  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to: [to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend failed to send login e-mail: ${error.message}`);
  }

  return { delivered: true, id: data?.id ?? null };
}

export async function sendNotificationEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const resend = getClient();
  if (!resend) {
    if (process.env.EMAIL_DEV_FALLBACK !== "true") {
      throw new Error("RESEND_API_KEY is not set; notification delivery is disabled.");
    }
    console.info(`[email:dev] ${input.subject} -> ${input.to}\n${input.text}`);
    return { delivered: false, id: null };
  }
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (error) throw new Error(`Resend notification failed: ${error.message}`);
  return { delivered: true, id: data?.id ?? null };
}
