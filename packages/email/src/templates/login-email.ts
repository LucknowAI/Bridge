/**
 * Login e-mail — carries BOTH redemption methods.
 *
 * The "Log In" button matches the instructions the existing login screen
 * already shows, and the 6-digit code below it backs the code-entry screen.
 * Whichever the user reaches for first consumes the challenge.
 *
 * Styled to the AI Community Lucknow palette (dark ground, amber accent) so it
 * reads as the same product as the login page. Table-based layout and inline
 * styles because e-mail clients ignore most modern CSS.
 */

export interface LoginEmailInput {
  name: string | null;
  code: string;
  magicLinkUrl: string;
  /** Minutes until the code and link expire. */
  expiresInMinutes: number;
}

const AMBER = "#f59e0b";
const INK = "#0a0a0e";
const PANEL = "#121216";
const TEXT = "#f4f4f5";
const MUTED = "#a1a1aa";

export function renderLoginEmail(input: LoginEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = input.name ? `Hi ${escapeHtml(input.name)},` : "Hi,";
  const spacedCode = input.code.split("").join(" ");

  const subject = `${input.code} is your Mr. Bridge login code`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${INK};">
  <!-- Preheader: shown in the inbox list, hidden in the body. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your login code is ${input.code}. It expires in ${input.expiresInMinutes} minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">

          <tr>
            <td align="center" style="padding-bottom:28px;">
              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:${TEXT};letter-spacing:0.5px;">
                AI Community <span style="color:${AMBER};">Lucknow</span>
              </div>
              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#52525b;letter-spacing:3px;text-transform:uppercase;padding-top:6px;">
                Mr. Bridge &middot; Access Portal
              </div>
            </td>
          </tr>

          <tr>
            <td style="background:${PANEL};border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:36px 32px;">

              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${TEXT};margin-bottom:6px;">
                Sign in to Mr. Bridge
              </div>
              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;line-height:1.6;margin-bottom:28px;">
                ${greeting} use either option below. Both expire in ${input.expiresInMinutes} minutes.
              </div>

              <!-- Option 1: one-click link -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:8px;">
                    <a href="${input.magicLinkUrl}"
                       style="display:inline-block;width:100%;box-sizing:border-box;text-align:center;padding:14px 0;background:${AMBER};border-radius:10px;color:${INK};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.5px;text-decoration:none;">
                      Log In
                    </a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                <tr>
                  <td style="border-top:1px solid rgba(255,255,255,0.08);"></td>
                  <td style="padding:0 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#52525b;letter-spacing:1.5px;white-space:nowrap;">OR ENTER CODE</td>
                  <td style="border-top:1px solid rgba(255,255,255,0.08);"></td>
                </tr>
              </table>

              <!-- Option 2: typed code -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:18px 0;">
                    <div style="font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:700;color:${AMBER};letter-spacing:8px;">
                      ${spacedCode}
                    </div>
                  </td>
                </tr>
              </table>

              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#52525b;line-height:1.7;margin-top:26px;">
                If you didn't request this, you can safely ignore this e-mail &mdash; nobody can sign in without it.
              </div>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:24px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#3f3f46;letter-spacing:2px;">
              AI COMMUNITY LUCKNOW &middot; MR. BRIDGE
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    input.name ? `Hi ${input.name},` : "Hi,",
    "",
    "Sign in to Mr. Bridge using either option below.",
    "",
    `Your login code: ${input.code}`,
    "",
    "Or open this link:",
    input.magicLinkUrl,
    "",
    `Both expire in ${input.expiresInMinutes} minutes.`,
    "If you didn't request this, you can safely ignore this e-mail.",
    "",
    "AI Community Lucknow - Mr. Bridge",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
