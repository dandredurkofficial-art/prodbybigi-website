const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendEmail, safeStr, RESEND_API_KEY, RESEND_FROM } = require("./emailUtils");

const db = admin.firestore();
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");

function moneyUsd(v) {
  const n = Number(v || 0);
  return `$${n.toFixed(2)}`;
}

function moneyKes(v) {
  const n = Number(v || 0);
  return `${n} KES`;
}

function formatDate(value) {
  try {
    if (!value) return new Date().toLocaleString();
    if (typeof value?.toDate === "function") return value.toDate().toLocaleString();
    if (typeof value === "number") return new Date(value).toLocaleString();
    return new Date(value).toLocaleString();
  } catch {
    return new Date().toLocaleString();
  }
}

function isProducerProfile(data) {
  return String(data?.role || "").toLowerCase() === "producer";
}

function getResultParametersArray(after) {
  return after?.rawResult?.Result?.ResultParameters?.ResultParameter || [];
}

function getResultParameterValue(after, keyName) {
  const arr = getResultParametersArray(after);
  for (const item of arr) {
    if (safeStr(item?.Key) === keyName) {
      return item?.Value;
    }
  }
  return "";
}

/* =========================================================
✅ 1) WELCOME EMAIL FOR NEW PRODUCER
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
      const email = safeStr(data.email).toLowerCase();
      const name = safeStr(data.displayName || data.name || "Producer");

      if (!email) return;

      await sendEmail({
        to: email,
        subject: "Welcome to Audiory 👋",
        text:
          `Dear ${name},\n\n` +
          `Welcome to Audiory.\n\n` +
          `Your producer account is now ready. You can upload beats, set prices, customize your store, and start selling.\n\n` +
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
                  You can now upload beats, set prices, customize your store, and start selling on Audiory.
                </p>
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

      console.log("Producer welcome email sent:", uid, email);
    } catch (e) {
      console.error("onProducerSignupWelcome error:", e);
    }
  }
);

/* =========================================================
✅ 2) PAYOUT PROCESSED EMAIL TO PRODUCER
   Watches payoutsRequests and sends only when M-Pesa result is successful
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

      // only fire when it becomes successful
      if (afterCode !== 0) return;
      if (beforeCode === 0) return;

      const producerId = safeStr(after.producerId);
      if (!producerId) {
        console.warn("onPayoutProcessed skipped: missing producerId on payout doc", payoutId);
        return;
      }

      const userSnap = await db.collection("users").doc(producerId).get();
      if (!userSnap.exists) {
        console.warn("onPayoutProcessed skipped: producer user not found", producerId);
        return;
      }

      const userData = userSnap.data() || {};
      const producerName = safeStr(userData.displayName || userData.name || "Producer");
      const producerEmail = safeStr(userData.email).toLowerCase();

      if (!producerEmail) {
        console.warn("onPayoutProcessed skipped: producer email missing", producerId);
        return;
      }

      const methodRaw = safeStr(after.method || "mpesa").toLowerCase();
      const paymentType = methodRaw === "mpesa" ? "M-Pesa" : methodRaw === "paypal" ? "PayPal" : safeStr(after.method || "Payment");

      let amountText = "";
      if (Number(after.amountUsd || 0) > 0) {
        amountText = moneyUsd(after.amountUsd);
      } else if (Number(after.amount || 0) > 0 && safeStr(after.currency).toUpperCase() === "USD") {
        amountText = moneyUsd(after.amount);
      } else if (Number(after.amountKes || 0) > 0) {
        amountText = moneyKes(after.amountKes);
      } else {
        amountText = `${Number(after.amount || 0)}`;
      }

      const receipt = safeStr(getResultParameterValue(after, "TransactionReceipt") || after.receipt || payoutId);
      const dateText =
        formatDate(after.paidAt) ||
        formatDate(after.updatedAt) ||
        formatDate(after.createdAt);

      await sendEmail({
        to: producerEmail,
        subject: "Payment processed successfully",
        text:
          `Dear ${producerName},\n\n` +
          `A payment was sent to you by Audiory.\n\n` +
          `Payment Type: ${paymentType}\n` +
          `Amount: ${amountText}\n` +
          `Invoice: ${receipt}\n` +
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
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Amount:</b> ${amountText}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Invoice:</b> ${receipt}</p>
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

      // optional but recommended: mark email sent
      await db.collection("payoutsRequests").doc(payoutId).set(
        {
          payoutEmailSent: true,
          payoutEmailSentAt: Date.now(),
        },
        { merge: true }
      );

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

      const buyerEmail = safeStr(after.buyerEmail).toLowerCase();
      if (!buyerEmail) return;

      const buyerName = safeStr(after.buyerName || "Buyer");
      const beatTitle = safeStr(after.beatTitle || "Beat");
      const producerName = safeStr(after.producerName || "Producer");
      const licenseKey = safeStr(after.licenseKey || "basic").toUpperCase();
      const provider = safeStr(after.provider || "Payment");
      const receipt = safeStr(after.receipt || orderId);

      const amountUsd = Number(after.amountUsd || 0);
      const amountKes = Number(after.amountKesPaid || after.amountKes || 0);

      const amountText =
        amountUsd > 0
          ? moneyUsd(amountUsd)
          : moneyKes(amountKes);

      const dateText = formatDate(after.paidAt || after.updatedAt || after.createdAt);

      await sendEmail({
        to: buyerEmail,
        subject: "Your Audiory invoice",
        text:
          `Dear ${buyerName},\n\n` +
          `Thank you for your purchase on Audiory.\n\n` +
          `Beat: ${beatTitle}\n` +
          `Producer: ${producerName}\n` +
          `License: ${licenseKey}\n` +
          `Payment Method: ${provider}\n` +
          `Amount: ${amountText}\n` +
          `Invoice: ${orderId}\n` +
          `Receipt: ${receipt}\n` +
          `Date: ${dateText}\n\n` +
          `If you have any questions, please contact support@audiory.site\n\n` +
          `Best Regards,\n` +
          `The Audiory Team`,
        html: `
          <div style="margin:0;padding:0;background:#0b0d12;font-family:Inter,Arial,sans-serif;color:#ffffff;">
            <div style="max-width:560px;margin:0 auto;padding:40px 16px;">
              <div style="background:#121726;border:1px solid #1d2230;border-radius:20px;padding:32px;">
                <h2 style="margin:0 0 16px;font-size:28px;color:#ffffff;">Your Audiory invoice</h2>

                <p style="margin:0 0 12px;color:#b6bfd6;line-height:1.7;">
                  Dear ${buyerName},
                </p>

                <p style="margin:0 0 18px;color:#b6bfd6;line-height:1.7;">
                  Thank you for your purchase on Audiory.
                </p>

                <div style="background:#0f1219;border:1px solid #1d2230;border-radius:14px;padding:16px;margin:18px 0;">
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Beat:</b> ${beatTitle}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Producer:</b> ${producerName}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>License:</b> ${licenseKey}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Payment Method:</b> ${provider}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Amount:</b> ${amountText}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Invoice:</b> ${orderId}</p>
                  <p style="margin:0 0 8px;color:#ffffff;"><b>Receipt:</b> ${receipt}</p>
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

      await db.collection("orders").doc(orderId).set(
        {
          invoiceEmailSent: true,
          invoiceEmailSentAt: Date.now(),
        },
        { merge: true }
      );

      console.log("Buyer invoice email sent:", orderId, buyerEmail);
    } catch (e) {
      console.error("onBuyerOrderPaidInvoice error:", e);
    }
  }
);
