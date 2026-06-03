const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const db = admin.firestore();

exports.sendNewsletter = onCall(
  {
    secrets: [RESEND_API_KEY],
    cors: true
  },
  async (request) => {
    try {
      const auth = request.auth;

      if (!auth) {
        throw new HttpsError(
          "unauthenticated",
          "Sign in required."
        );
      }

      const adminDoc = await db
        .collection("users")
        .doc(auth.uid)
        .get();

      if (!adminDoc.exists || adminDoc.data()?.isAdmin !== true) {
        throw new HttpsError(
          "permission-denied",
          "Admins only."
        );
      }

      const subject = String(
        request.data?.subject || ""
      ).trim();

      const html = String(
        request.data?.html || ""
      ).trim();

      const newsletterContent = html;
      const wrappedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      </head>

      <body style="margin:0;padding:0;background:#0f0f12;font-family:Arial,sans-serif;">

      <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
      <td align="center" style="padding:40px 15px;">

      <table width="600" cellpadding="0" cellspacing="0"
      style="background:#17171c;border-radius:16px;overflow:hidden;max-width:600px;">

      <tr>
      <td style="background:#7c3aed;padding:30px;text-align:center;">

      <h1 style="margin:0;color:#fff;">
      AUDIORY
      </h1>

      <p style="margin-top:10px;color:#e9d5ff;">
      Music Producers Marketplace
      </p>

      </td>
      </tr>

      <tr>
      <td style="padding:40px;">

      <h2 style="color:#fff;">
      ${subject}
      </h2>

      <div style="color:#d1d5db;line-height:1.8;">
      ${newsletterContent}
      </div>

      <p style="text-align:center;margin-top:35px;">
      <a href="https://audiory.site"
      style="
      background:#7c3aed;
      padding:14px 24px;
      color:#fff;
      text-decoration:none;
      border-radius:8px;
      display:inline-block;
      font-weight:bold;
      ">
      Open Audiory
      </a>
      </p>

      </td>
      </tr>

      <tr>
      <td style="
      padding:25px;
      text-align:center;
      border-top:1px solid #2a2a2a;
      ">

      <p style="color:#9ca3af;">
      Follow Audiory
      </p>

      <p>
      <a href="https://www.instagram.com/audiorybeatstore">Instagram</a>
       |
      <a href="https://www.tiktok.com/@audiorybeatstore">TikTok</a>
       |
      <a href="https://www.facebook.com/audiorybeatstore">Facebook</a>
       |
      <a href="https://www.youtube.com/@audiorybeatstore">Youtube</a>
      </p>

      <p style="font-size:12px;color:#6b7280;">
      © 2026 Audiory. All Rights Reserved.
      </p>

      <p style="font-size:12px;color:#6b7280;">
      You received this email because you subscribed to Audiory.
      </p>

      </td>
      </tr>

      </table>

      </td>
      </tr>
      </table>

      </body>
      </html>
      `;

      if (!subject || !html) {
        throw new HttpsError(
          "invalid-argument",
          "Subject and html required."
        );
      }

      const resend = new Resend(
        RESEND_API_KEY.value()
      );

      const snap = await db
        .collection("newsletterSubscribers")
        .where("subscribed", "==", true)
        .get();

      let sentCount = 0;

      for (const doc of snap.docs) {
        const sub = doc.data();

        const email = String(
          sub.email || ""
        ).trim();

        if (!email) continue;

        try {
          await resend.emails.send({
            from: "Audiory <noreply@mail.audiory.site>",
            to: email,
            subject,
            html: wrappedHtml
          });

          sentCount++;
        } catch (err) {
          console.error(
            "newsletter send failed",
            email,
            err
          );
        }
      }

      await db.collection("newsletterCampaigns").add({
        subject,
        html,
        sentCount,
        createdAt: Date.now(),
        createdBy: auth.uid,
        status: "sent"
      });

      return {
        success: true,
        sentCount
      };

    } catch (err) {
      console.error(err);
      throw new HttpsError(
        "internal",
        err.message || "Newsletter failed."
      );
    }
  }
);
