const { defineSecret } = require("firebase-functions/params");
const { Resend } = require("resend");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

let RESEND_CLIENT = null;

function safeStr(v) {
  return String(v ?? "").trim();
}

function getResendClient() {
  if (RESEND_CLIENT) return RESEND_CLIENT;

  const key = RESEND_API_KEY.value();
  if (!key) throw new Error("Missing RESEND_API_KEY secret");

  RESEND_CLIENT = new Resend(key);
  return RESEND_CLIENT;
}

async function sendEmail({ to, subject, text, html }) {
  const resend = getResendClient();

  const from = "Audiory <noreply@mail.audiory.site>";

  const result = await resend.emails.send({
    from,
    to,
    subject,
    text: text || "",
    html: html || "",
  });

  if (result?.error) {
    throw new Error(result.error.message || "Failed to send email");
  }

  return result;
}

module.exports = {
  RESEND_API_KEY,
  safeStr,
  sendEmail,
};
