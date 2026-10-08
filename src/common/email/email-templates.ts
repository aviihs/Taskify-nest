export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        ch
      ] as string),
  );

function layout(title: string, body: string, footerNote: string): string {
  return `
  <div style="font-family: Arial, sans-serif; background-color: #f4f7fb; padding: 40px 20px;">
    <div style="max-width: 500px; margin: auto; background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); text-align: center;">
      <h2 style="color: #2563eb; margin-bottom: 10px;">🚀 Taskify</h2>
      <h3 style="color: #333;">${title}</h3>
      ${body}
      <p style="color: #999; font-size: 13px; margin-top: 30px;">${footerNote}</p>
      <hr style="border:none; border-top:1px solid #eee; margin:25px 0;">
      <p style="color:#aaa; font-size:12px;">© ${new Date().getFullYear()} Taskify. All rights reserved.</p>
    </div>
  </div>`;
}

interface OtpEmailInput {
  firstName: string;
  otp: string;
  expiresInMinutes: number;
  purpose: 'verify-email' | 'reset-password';
}

const OTP_COPY = {
  'verify-email': {
    subject: 'Verify Your Email - Taskify',
    title: 'Email Verification',
    intro: 'Please use the verification code below to activate your account.',
    ignore:
      'If you did not create a Taskify account, you can safely ignore this email.',
  },
  'reset-password': {
    subject: 'Password Reset OTP - Taskify',
    title: 'Password Reset Verification',
    intro: 'Please use the verification code below to reset your password.',
    ignore:
      'If you did not request a password reset, you can safely ignore this email.',
  },
} as const;

export function otpEmail({
  firstName,
  otp,
  expiresInMinutes,
  purpose,
}: OtpEmailInput): EmailContent {
  const copy = OTP_COPY[purpose];
  const name = escapeHtml(firstName);
  const body = `
      <p style="color: #555; font-size: 15px;">Hello <b>${name}</b>,</p>
      <p style="color: #555; font-size: 15px; line-height: 1.6;">${copy.intro}</p>
      <div style="background: #eff6ff; border: 2px dashed #2563eb; border-radius: 10px; padding: 20px; margin: 25px 0;">
        <h1 style="letter-spacing: 8px; color: #2563eb; margin: 0; font-size: 36px;">${otp}</h1>
      </div>
      <p style="color: #777; font-size: 14px;">⏳ This verification code will expire in <b>${expiresInMinutes} minutes</b>.</p>`;

  return {
    subject: copy.subject,
    text: `Hello ${firstName}, your Taskify verification code is ${otp}. This code expires in ${expiresInMinutes} minutes.`,
    html: layout(copy.title, body, copy.ignore),
  };
}

interface InvitationEmailInput {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
}

export function invitationEmail({
  inviterName,
  workspaceName,
  role,
  acceptUrl,
}: InvitationEmailInput): EmailContent {
  const body = `
      <p style="color: #555; font-size: 15px; line-height: 1.6;">
        <b>${escapeHtml(inviterName)}</b> invited you to join
        <b>${escapeHtml(workspaceName)}</b> as <b>${escapeHtml(role)}</b>.
      </p>
      <a href="${encodeURI(
        acceptUrl,
      )}" style="display:inline-block; margin: 20px 0; padding: 12px 24px; background:#2563eb; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">
        View invitation
      </a>
      <p style="color: #777; font-size: 14px;">Don't have an account yet? Sign up with this email address and the invitation will be waiting for you.</p>`;

  return {
    subject: `You're invited to ${workspaceName} on Taskify`,
    text: `${inviterName} invited you to join ${workspaceName} on Taskify as ${role}. Open ${acceptUrl} to respond.`,
    html: layout(
      'Workspace Invitation',
      body,
      'If you were not expecting this invitation, you can ignore this email.',
    ),
  };
}
