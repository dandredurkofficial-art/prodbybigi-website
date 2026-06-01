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
            from: "Audiory <newsletter@audiory.site>",
            to: email,
            subject,
            html
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
