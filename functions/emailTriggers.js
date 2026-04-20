const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendEmail, safeStr, RESEND_API_KEY, RESEND_FROM } = require("./emailUtils");

const db = admin.firestore();
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");

function money(v) {
  const n = Number(v || 0);
  return `$${n.toFixed(2)}`;
}

function fmtDate(v) {
  const ms = Number(v || Date.now());
  if (!ms) return new Date().toLocaleString();
  return new Date(ms).toLocaleString();
}

function isProducerProfile(data) {
  return String(data?.role || "").toLowerCase() === "producer";
}

/* =========================================================
✅ 1) WELCOME EMAIL FOR PRODUCER SIGNUP
========================================================= */
exports.onProducerSignupWelcome = onDocumentCreated(
  {
    region: "us-central1",
    document: "users/{uid}",
    secrets: [RESEND_API_KEY, RESEND_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const data = event.data?.data() || {};
      if (!isProducerProfile(data)) return;

      const uid = event.params.uid;
      const email = safeStr(data.email);
      const name = safeStr(data.displayName || data.name || "Producer");

      if (!email) return;

      await sendEmail({
        to: email,
        subject: "Welcome to Audiory 👋",
        text:
          `Dear ${name},\n\n` +
          `Welcome to Audiory.\n\n` +
          `Your producer account is now ready. You can upload beats, set prices, build your store, and start selling.\n\n` +
          `If you have any questions, please contact support@audiory.site\n\n` +
          `Best Regards,\n` +
          `The Audiory Team`,
        html: `
          <div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#ffffff;">
            <div style="max-width:560px;margin:0 auto;padding:40px 16px;">
              <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">
                <h2 style="margin:0 0 16px;font-size:28px;color:#ffffff;">Welcome to Audiory 👋</h2>
                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">Dear ${name},</p>
                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  Your producer account is now ready.
                </p>
                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  You can now upload beats, set prices, build your store, and start selling on Audiory.
                </p>
                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  If you have any questions, please contact
                  <a href="mailto:support@audiory.site" style="color:#6cf;text-decoration:none;">support@audiory.site</a>.
                </p>
                <p style="margin:18px 0 0;color:#9ca3af;line-height:1.7;">
                  Best Regards,<br>
                  The Audiory Team
                </p>
              </div>
            </div>
          </div>
        `,
      });

      const adminTo = safeStr(ADMIN_NOTIFY_EMAIL.value());
      if (adminTo) {
        await sendEmail({
          to: adminTo,
          subject: "New producer signup on Audiory",
          text:
            `A new producer signed up.\n\n` +
            `Name: ${name}\n` +
            `Email: ${email}\n` +
            `UID: ${uid}`,
          html: `
            <h2>New producer signup</h2>
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>UID:</b> ${uid}</p>
          `,
        });
      }
    } catch (e) {
      console.error("onProducerSignupWelcome error:", e);
    }
  }
);

/* =========================================================
✅ 2) PAYOUT PROCESSED EMAIL TO PRODUCER
   Trigger when payout status becomes "paid" or "completed"
========================================================= */
exports.onPayoutProcessed = onDocumentUpdated(
  {
    region: "us-central1",
    document: "payoutsRequests/{payoutId}",
    secrets: [RESEND_API_KEY, RESEND_FROM],
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const payoutId = event.params.payoutId;

      const beforeCode = Number(before?.rawResult?.Result?.ResultCode);
      const afterCode = Number(after?.rawResult?.Result?.ResultCode);

      // only send when result becomes successful
      if (afterCode !== 0) return;
      if (beforeCode === 0) return;

      const producerId = safeStr(after.producerId);
      if (!producerId) return;

      const userSnap = await db.collection("users").doc(producerId).get();
      if (!userSnap.exists) return;

      const userData = userSnap.data() || {};
      const producerName = safeStr(userData.displayName || userData.name || "Producer");
      const producerEmail = safeStr(userData.email).toLowerCase();

      if (!producerEmail) return;

      const paymentType = safeStr(after.method || "mpesa").toUpperCase();
      const amount =
        Number(after.amountUsd || after.amount || 0) > 0
          ? `$${Number(after.amountUsd || after.amount || 0).toFixed(2)}`
          : `${Number(after.amountKes || 0)} KES`;

      const dateText = new Date(Number(after.createdAt || Date.now())).toLocaleString();

      let invoice = payoutId;
      let transactionReceipt = "";

      const resultParams =
        after?.rawResult?.Result?.ResultParameters?.ResultParameter || [];

      for (const item of resultParams) {
        const key = safeStr(item?.Key);
        const value = safeStr(item?.Value);

        if (key === "TransactionReceipt") {
          transactionReceipt = value;
        }
      }

      if (transactionReceipt) {
        invoice = transactionReceipt;
      }

      await sendEmail({
        to: producerEmail,
        subject: "Payment processed successfully",
        text:
          `Dear ${producerName},\n\n` +
          `A payment was sent to you by Audiory.\n\n` +
          `Payment Type: ${paymentType}\n` +
          `Amount: ${amount}\n` +
          `Invoice: ${invoice}\n` +
          `Date: ${dateText}\n\n` +
          `If you have any questions, please contact support@audiory.site\n\n` +
          `Best Regards,\n` +
          `The Audiory Team`,
        html: `
          <div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#ffffff;">
            <div style="max-width:560px;margin:0 auto;padding:40px 16px;">
              <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">
                <h2 style="margin:0 0 16px;font-size:28px;color:#ffffff;">Payment processed successfully</h2>

                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  Dear ${producerName},
                </p>

                <p style="margin:0 0 18px;color:#b6bfd6;line-height:1.7;">
                  A payment was sent to you by Audiory.
                </p>

                <div style="background:#0f1219;border:1px solid #1d2230;border-radius:14px;padding:16px;margin:18px 0;">
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Payment Type:</b> ${paymentType}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Amount:</b> ${amount}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Invoice:</b> ${invoice}</p>
                  <p style="margin:0;color:#ffffff;"><b>Date:</b> ${dateText}</p>
                </div>

                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  If you have any questions, please contact
                  <a href="mailto:support@audiory.site" style="color:#6cf;text-decoration:none;">support@audiory.site</a>
                </p>

                <p style="margin:18px 0 0;color:#9ca3af;line-height:1.7;">
                  Best Regards,<br>
                  The Audiory Team
                </p>
              </div>
            </div>
          </div>
        `,
      });

      console.log("Payout processed email sent:", payoutId, producerEmail);
    } catch (e) {
      console.error("onPayoutProcessed error:", e);
    }
  }
);

/* =========================================================
✅ 3) BUYER INVOICE EMAIL AFTER ORDER PAID
========================================================= */
exports.onBuyerOrderPaidInvoice = onDocumentUpdated(
  {
    region: "us-central1",
    document: "orders/{orderId}",
    secrets: [RESEND_API_KEY, RESEND_FROM],
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const orderId = event.params.orderId;

      const beforeStatus = safeStr(before.status).toUpperCase();
      const afterStatus = safeStr(after.status).toUpperCase();

      if (beforeStatus === afterStatus) return;
      if (afterStatus !== "PAID") return;

      const buyerId = safeStr(after.buyerId);
      let buyerName = "Buyer";
      let buyerEmail = safeStr(after.buyerEmail || after.email);

      if (buyerId) {
        try {
          const buyerSnap = await db.collection("users").doc(buyerId).get();
          if (buyerSnap.exists) {
            const b = buyerSnap.data() || {};
            buyerName = safeStr(b.displayName || b.name || "Buyer");
            if (!buyerEmail) buyerEmail = safeStr(b.email);
          }
        } catch (_) {}
      }

      if (!buyerEmail) return;

      let beatTitle = safeStr(after.itemTitle || after.beatTitle || "Beat");
      let producerName = safeStr(after.producerName || "Producer");

      const beatId = safeStr(after.beatId);
      if (beatId) {
        try {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) {
            const beat = beatSnap.data() || {};
            beatTitle = safeStr(beat.title || beat.beatTitle || beatTitle);
            producerName = safeStr(beat.producerName || producerName);
          }
        } catch (_) {}
      }

      const amount = money(after.amount);
      const licenseKey = safeStr(after.licenseKey || after.license || "basic");
      const dateText = fmtDate(after.updatedAt || after.createdAt || Date.now());

      await sendEmail({
        to: buyerEmail,
        subject: "Your Audiory invoice",
        text:
          `Dear ${buyerName},\n\n` +
          `Thank you for your purchase on Audiory.\n\n` +
          `Beat: ${beatTitle}\n` +
          `Producer: ${producerName || "—"}\n` +
          `License: ${licenseKey}\n` +
          `Amount: ${amount}\n` +
          `Invoice: ${orderId}\n` +
          `Date: ${dateText}\n\n` +
          `If you have any questions, please contact support@audiory.site\n\n` +
          `Best Regards,\n` +
          `The Audiory Team`,
        html: `
          <div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#ffffff;">
            <div style="max-width:560px;margin:0 auto;padding:40px 16px;">
              <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">
                <h2 style="margin:0 0 16px;font-size:28px;color:#ffffff;">Your Audiory invoice</h2>
                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">Dear ${buyerName},</p>
                <p style="margin:0 0 18px;color:#b6bfd6;line-height:1.7;">
                  Thank you for your purchase on Audiory.
                </p>

                <div style="background:#0f1219;border:1px solid #1d2230;border-radius:14px;padding:16px;margin:18px 0;">
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Beat:</b> ${beatTitle}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Producer:</b> ${producerName || "—"}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>License:</b> ${licenseKey}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Amount:</b> ${amount}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Invoice:</b> ${orderId}</p>
                  <p style="margin:0;color:#ffffff;"><b>Date:</b> ${dateText}</p>
                </div>

                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  If you have any questions, please contact
                  <a href="mailto:support@audiory.site" style="color:#6cf;text-decoration:none;">support@audiory.site</a>.
                </p>

                <p style="margin:18px 0 0;color:#9ca3af;line-height:1.7;">
                  Best Regards,<br>
                  The Audiory Team
                </p>
              </div>
            </div>
          </div>
        `,
      });
    } catch (e) {
      console.error("onBuyerOrderPaidInvoice error:", e);
    }
  }
);
