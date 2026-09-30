import nodemailer, { type Transporter } from "nodemailer";

export const VOTECHAIN_SENDER_EMAIL = "votechain.verify@gmail.com";
export const VOTECHAIN_SENDER = `"VoteChain Verification" <${VOTECHAIN_SENDER_EMAIL}>`;

export interface SendVerificationEmailParams {
  to: string;
  name: string;
  studentId: string;
  token: string;
}

export interface SentEmailRecord {
  to: string;
  subject: string;
  verifyUrl: string;
  token: string;
  sentAt: Date;
}

// In-memory record of sent emails for auditing and test assertions
const sentEmailHistory: SentEmailRecord[] = [];

export function getSentEmailHistory(): SentEmailRecord[] {
  return [...sentEmailHistory];
}

export function clearSentEmailHistory(): void {
  sentEmailHistory.length = 0;
}

let transportOverride: Transporter | null = null;

export function setTransportOverride(transporter: Transporter | null): void {
  transportOverride = transporter;
}

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function getTransporter(): Transporter | null {
  if (transportOverride) return transportOverride;

  const user = (process.env.EMAIL_USER || process.env.test_mail || VOTECHAIN_SENDER_EMAIL).trim();
  const pass = (process.env.EMAIL_APP_PASSWORD || process.env.test_pass || "").trim();

  if (!pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });
}

export function generateVerificationEmailHtml(name: string, studentId: string, verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your VoteChain Account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0b0f19; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #111827; border: 1px solid #1f2937; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; border-bottom: 1px solid #1f2937; background: linear-gradient(180deg, #161f33 0%, #111827 100%);">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: #ffffff;">votechain<span style="color: #10b981;">.</span></span>
                    <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; margin-top: 4px;">PSG Tech Campus Election Network</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <h1 style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 16px; line-height: 1.3;">Verify Your Email Address</h1>
              <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin: 0 0 20px;">
                Hello <strong>${name}</strong> (<code style="background-color: #1e293b; color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${studentId}</code>),
              </p>
              <p style="font-size: 14px; color: #94a3b8; line-height: 1.6; margin: 0 0 28px;">
                Thank you for registering on <strong>VoteChain</strong>. To participate in your campus elections with cryptographic verification and privacy protection, please confirm your official PSG Tech email address.
              </p>

              <!-- CTA Button -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 28px;">
                <tr>
                  <td align="center">
                    <a href="${verifyUrl}" target="_blank" style="display: inline-block; background-color: #10b981; color: #022c22; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);">
                      Verify Email Address &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 12px; color: #64748b; line-height: 1.6; margin: 0 0 12px;">
                Button not working? Copy and paste the link below into your browser:
              </p>
              <p style="font-size: 11px; color: #38bdf8; word-break: break-all; margin: 0 0 24px; padding: 10px; background-color: #0f172a; border-radius: 6px; border: 1px solid #1e293b;">
                <a href="${verifyUrl}" style="color: #38bdf8; text-decoration: underline;">${verifyUrl}</a>
              </p>

              <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
                <p style="font-size: 12px; color: #64748b; margin: 0 0 6px;">
                  &#9201; This link is valid for <strong>24 hours</strong> and can only be used once.
                </p>
                <p style="font-size: 12px; color: #64748b; margin: 0;">
                  &#128274; If you did not register for VoteChain, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #0d131f; border-top: 1px solid #1f2937; text-align: center;">
              <p style="font-size: 11px; color: #475569; margin: 0;">
                Sent by VoteChain Election Authority &bull; Official Campus Voting Prototype<br/>
                Sender: <a href="mailto:${VOTECHAIN_SENDER_EMAIL}" style="color: #64748b; text-decoration: none;">${VOTECHAIN_SENDER_EMAIL}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function generateVerificationEmailText(name: string, studentId: string, verifyUrl: string): string {
  return `VoteChain — Campus Election Verification

Hello ${name} (${studentId}),

Thank you for registering on VoteChain. Please confirm your official PSG Tech email address to participate in campus elections:

Verify your email:
${verifyUrl}

This verification link will expire in 24 hours and can only be used once.

If you did not create a VoteChain account, please ignore this email.

---
VoteChain Verification Service
Sender: ${VOTECHAIN_SENDER_EMAIL}
`;
}

export async function sendVerificationEmail(params: SendVerificationEmailParams): Promise<{
  success: boolean;
  verifyUrl: string;
  messageId?: string;
  error?: string;
}> {
  const { to, name, studentId, token } = params;
  const baseUrl = getAppBaseUrl();
  const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const subject = "VoteChain — Verify your PSG Tech email address";
  const html = generateVerificationEmailHtml(name, studentId, verifyUrl);
  const text = generateVerificationEmailText(name, studentId, verifyUrl);

  // Record into history
  sentEmailHistory.push({
    to,
    subject,
    verifyUrl,
    token,
    sentAt: new Date(),
  });

  const transporter = getTransporter();

  if (!transporter) {
    console.warn(`[VoteChain Email] No SMTP credentials configured. Recorded email for ${to}: ${verifyUrl}`);
    return {
      success: true,
      verifyUrl,
      messageId: `simulated-${Date.now()}`,
    };
  }

  try {
    const info = await transporter.sendMail({
      from: VOTECHAIN_SENDER,
      to,
      subject,
      text,
      html,
    });

    console.info(`[VoteChain Email] Sent verification email to ${to} (MessageId: ${info.messageId})`);
    return {
      success: true,
      verifyUrl,
      messageId: info.messageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP send failure";
    console.error(`[VoteChain Email] Failed to send email to ${to}:`, message);
    return {
      success: false,
      verifyUrl,
      error: message,
    };
  }
}
