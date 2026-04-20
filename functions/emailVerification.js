const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const crypto = require("crypto");

const db = admin.firestore();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const APP_BASE_URL = defineSecret("APP_BASE_URL");

let RESEND_CLIENT = null;

function safeStr(v) {
  return String(v || "");
}

function handleCorsPreflight(req, res) {
  if (req.method === "OPTIONS") {
    applyCors(req, res);
    res.status(204).send("");
    return true;
  }
  return false;
}

function applyCors(req, res) {
  const allowed = [
    "https://audiory.site",
    "https://www.audiory.site",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ];

  const origin = req.headers.origin || "";
  if (allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

function makeVerifyToken() {
  return crypto.randomBytes(32).toString("hex");
}

function verifyEmailExpiryMs() {
  return 1000 * 60 * 60 * 24;
}

function getAppBaseUrl() {
  const url = safeStr(APP_BASE_URL.value() || "https://audiory.site").trim();
  return url || "https://audiory.site";
}

function verifyEmailLink(token, email) {
  const base = getAppBaseUrl();
  const qs = new URLSearchParams({
    token: safeStr(token),
    email: safeStr(email || ""),
  });
  return `${base}/verify-email/?${qs.toString()}`;
}

function verifyEmailHtml({ name, verifyUrl, email }) {
  const displayName = safeStr(name || "there");
  const safeEmail = safeStr(email || "");

  return `
    <div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#ffffff;">
      <div style="max-width:560px;margin:0 auto;padding:40px 16px;">
        <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">
          <div style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:14px;color:#ffffff;">
            Verify your email
          </div>

          <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;font-size:15px;">
            Hey ${displayName},
          </p>

          <p style="margin:0 0 14px;color:#b6bfd6;line-height:1.7;font-size:15px;">
            Welcome to <span style="color:#ffffff;font-weight:700;">Audiory</span>. Please confirm your email address to activate your account.
          </p>

          <div style="margin:18px 0;padding:14px 16px;border-radius:14px;background:#0f1219;border:1px solid #1d2230;color:#ffffff;font-weight:700;word-break:break-word;">
            ${safeEmail}
          </div>

          <div style="margin:26px 0 22px;">
            <a href="${verifyUrl}"
               style="display:inline-block;padding:14px 24px;border-radius:12px;background:#6cf;color:#081018;text-decoration:none;font-weight:800;font-size:15px;">
              Verify Email
            </a>
          </div>

          <p style="margin:0 0 12px;color:#9ca3af;line-height:1.7;font-size:14px;">
            This verification link will expire in 24 hours.
          </p>

          <p style="margin:0 0 10px;color:#9ca3af;line-height:1.7;font-size:14px;">
            If the button does not work, copy and paste this link into your browser:
          </p>

          <p style="margin:0;word-break:break-word;font-size:13px;line-height:1.7;">
            <a href="${verifyUrl}" style="color:#6cf;text-decoration:none;">${verifyUrl}</a>
          </p>

          <hr style="border:none;border-top:1px solid #1d2230;margin:24px 0;">

          <p style="margin:0;color:#7f8aa3;font-size:13px;line-height:1.7;">
            If you did not create an Audiory account, you can safely ignore this email.
          </p>

          <p style="margin:14px 0 0;color:#9ca3af;font-size:13px;line-height:1.7;">
            — Audiory Team
          </p>
        </div>
      </div>
    </div>
  `;
}

function verifyEmailText({ name, verifyUrl, email }) {
  return [
    `Hey ${safeStr(name || "there")},`,
    ``,
    `Welcome to Audiory.`,
    `Please verify your email address to activate your account.`,
    ``,
    `Email: ${safeStr(email || "")}`,
    ``,
    `Verification link:`,
    `${verifyUrl}`,
    ``,
    `This link expires in 24 hours.`,
    ``,
    `If you did not create an Audiory account, you can safely ignore this email.`,
    ``,
    `— Audiory Team`,
  ].join("\n");
}

async function createAndSendVerificationEmail({ uid, email, name }) {
  const cleanEmail = safeStr(email).trim().toLowerCase();
  if (!cleanEmail) throw new Error("Email is required");

  const token = makeVerifyToken();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + verifyEmailExpiryMs();

  await db.collection("emailVerifications").doc(uid).set(
    {
      uid,
      email: cleanEmail,
      tokenHash,
      createdAt: Date.now(),
      expiresAt,
      used: false,
      usedAt: null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  const url = verifyEmailLink(token, cleanEmail);

  await sendEmail({
    to: cleanEmail,
    subject: "Verify your Audiory account",
    text: verifyEmailText({ name, verifyUrl: url, email: cleanEmail }),
    html: verifyEmailHtml({ name, verifyUrl: url, email: cleanEmail }),
  });

  return { ok: true, expiresAt };
}

exports.sendVerificationEmail = onRequest(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, APP_BASE_URL],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { uid, email, name } = req.body || {};
      const cleanUid = safeStr(uid).trim();
      const cleanEmail = safeStr(email).trim().toLowerCase();
      const cleanName = safeStr(name || "there").trim();

      if (!cleanUid) return res.status(400).json({ error: "uid is required" });
      if (!cleanEmail) return res.status(400).json({ error: "email is required" });

      const userSnap = await db.collection("users").doc(cleanUid).get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const userData = userSnap.data() || {};
      const savedEmail = safeStr(userData.email).trim().toLowerCase();

      if (savedEmail && savedEmail !== cleanEmail) {
        return res.status(400).json({ error: "Email does not match user record" });
      }

      if (userData.emailVerified === true) {
        return res.json({ ok: true, alreadyVerified: true });
      }

      await createAndSendVerificationEmail({
        uid: cleanUid,
        email: cleanEmail,
        name: cleanName || safeStr(userData.displayName || userData.name || "there"),
      });

      await db.collection("users").doc(cleanUid).set(
        {
          emailVerificationSentAt: Date.now(),
          emailVerified: false,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({ ok: true, message: "Verification email sent" });
    } catch (e) {
      console.error("sendVerificationEmail error:", e?.message || e);
      return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
    }
  }
);

exports.verifyEmailToken = onRequest(
  {
    region: "us-central1",
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { token, email } = req.body || {};
      const rawToken = safeStr(token).trim();
      const cleanEmail = safeStr(email).trim().toLowerCase();

      if (!rawToken) return res.status(400).json({ ok: false, error: "token is required" });
      if (!cleanEmail) return res.status(400).json({ ok: false, error: "email is required" });

      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const snap = await db
        .collection("emailVerifications")
        .where("tokenHash", "==", tokenHash)
        .where("email", "==", cleanEmail)
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(400).json({ ok: false, error: "Invalid verification link" });
      }

      const docSnap = snap.docs[0];
      const data = docSnap.data() || {};
      const uid = safeStr(data.uid).trim();

      if (!uid) {
        return res.status(400).json({ ok: false, error: "Verification record is invalid" });
      }

      if (data.used === true) {
        return res.json({
          ok: true,
          alreadyVerified: true,
          uid,
          email: cleanEmail,
        });
      }

      if (Number(data.expiresAt || 0) < Date.now()) {
        return res.status(400).json({ ok: false, error: "Verification link expired" });
      }

      await db.collection("users").doc(uid).set(
        {
          emailVerified: true,
          emailVerifiedAt: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      try {
        await admin.auth().updateUser(uid, { emailVerified: true });
      } catch (e) {
        console.warn("admin auth update failed:", e?.message || e);
      }

      await docSnap.ref.set(
        {
          used: true,
          usedAt: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({
        ok: true,
        verified: true,
        uid,
        email: cleanEmail,
      });
    } catch (e) {
      console.error("verifyEmailToken error:", e?.message || e);
      return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
    }
  }
);

exports.resendVerificationEmail = onRequest(
  {
    region: "us-central1",
    secrets: [RESEND_API_KEY, APP_BASE_URL],
  },
  async (req, res) => {
    const stop = handleCorsPreflight(req, res);
    if (stop) return;
    applyCors(req, res);

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Use POST" });
      }

      const { uid } = req.body || {};
      const cleanUid = safeStr(uid).trim();
      if (!cleanUid) return res.status(400).json({ error: "uid is required" });

      const userSnap = await db.collection("users").doc(cleanUid).get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const userData = userSnap.data() || {};
      const email = safeStr(userData.email).trim().toLowerCase();
      const name = safeStr(userData.displayName || userData.name || "there");

      if (!email) return res.status(400).json({ error: "User email missing" });

      if (userData.emailVerified === true) {
        return res.json({ ok: true, alreadyVerified: true });
      }

      await createAndSendVerificationEmail({
        uid: cleanUid,
        email,
        name,
      });

      await db.collection("users").doc(cleanUid).set(
        {
          emailVerificationSentAt: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return res.json({ ok: true, message: "Verification email sent again" });
    } catch (e) {
      console.error("resendVerificationEmail error:", e?.message || e);
      return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
    }
  }
);
