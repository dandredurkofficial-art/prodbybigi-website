const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { sendEmail, safeStr, RESEND_API_KEY } = require("./emailUtils");

const db = admin.firestore();
const ADMIN_NOTIFY_EMAIL = defineSecret("ADMIN_NOTIFY_EMAIL");
const RESEND_FROM = defineSecret("RESEND_FROM");

function money(v) {
  const n = Number(v || 0);
  return `$${n.toFixed(2)}`;
}

function isProducerProfile(data) {
  return String(data?.role || "").toLowerCase() === "producer";
}

exports.onProducerSignup = onDocumentCreated(
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
      const adminTo = safeStr(ADMIN_NOTIFY_EMAIL.value());

      if (adminTo) {
        await sendEmail({
          to: adminTo,
          subject: "New producer signup on Audiory",
          text: `A new producer signed up.\n\nName: ${name}\nEmail: ${email || "—"}\nUID: ${uid}`,
          html: `
            <h2>New producer signup</h2>
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email || "—"}</p>
            <p><b>UID:</b> ${uid}</p>
          `,
        });
      }

      if (email) {
        await sendEmail({
          to: email,
          subject: "Welcome to Audiory 👋",
          text:
            `Hey ${name}, welcome to Audiory!\n\n` +
            `You can now upload beats, set prices, and start selling.\n\n` +
            `If you need help, reply to this email.\n\n` +
            `— Audiory Team`,
          html: `
            <h2>Welcome to Audiory 👋</h2>
            <p>Hey ${name},</p>
            <p>Welcome to <b>Audiory</b>! You can now upload beats, set prices, and start selling.</p>
            <p>If you need help, just reply to this email.</p>
            <p style="margin-top:14px;">— Audiory Team</p>
          `,
        });
      }
    } catch (e) {
      console.error("onProducerSignup email error:", e);
    }
  }
);

exports.onUserBecameProducer = onDocumentWritten(
  {
    region: "us-central1",
    maxInstances: 1,
    document: "users/{uid}",
    secrets: [RESEND_API_KEY, RESEND_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const before = event.data?.before?.data() || {};
      const after = event.data?.after?.data() || {};
      const uid = event.params.uid;

      const wasProducer = isProducerProfile(before);
      const isProducer = isProducerProfile(after);

      if (wasProducer || !isProducer) return;
      if (after.welcomeEmailSent === true) return;

      const email = safeStr(after.email);
      const name = safeStr(after.displayName || after.name || "Producer");
      const adminTo = safeStr(ADMIN_NOTIFY_EMAIL.value());

      if (adminTo) {
        await sendEmail({
          to: adminTo,
          subject: "Producer activated on Audiory",
          text: `A user became a producer.\n\nName: ${name}\nEmail: ${email || "—"}\nUID: ${uid}`,
          html: `
            <h2>Producer activated</h2>
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email || "—"}</p>
            <p><b>UID:</b> ${uid}</p>
          `,
        });
      }

      if (email) {
        await sendEmail({
          to: email,
          subject: "Welcome to Audiory",
          text:
            `Hey ${name}, welcome to Audiory!\n\n` +
            `You can now upload beats, set prices, and start selling.\n\n` +
            `— Audiory Team`,
          html:
            `<h2>Welcome to Audiory</h2>` +
            `<p>Hey ${name},</p>` +
            `<p>You can now upload beats, set prices, and start selling.</p>` +
            `<p style="margin-top:14px;">— Audiory Team</p>`,
        });
      }

      await db.collection("users").doc(uid).set(
        {
          welcomeEmailSent: true,
          welcomeEmailSentAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error("onUserBecameProducer email error:", e);
    }
  }
);

exports.onPayoutRequest = onDocumentCreated(
  {
    region: "us-central1",
    maxInstances: 1,
    document: "payoutsRequests/{payoutId}",
    secrets: [RESEND_API_KEY, RESEND_FROM, ADMIN_NOTIFY_EMAIL],
  },
  async (event) => {
    try {
      const data = event.data?.data() || {};
      const payoutId = event.params.payoutId;
      const adminTo = safeStr(ADMIN_NOTIFY_EMAIL.value());
      if (!adminTo) return;

      await sendEmail({
        to: adminTo,
        subject: "New payout request on Audiory",
        text:
          `A producer requested a payout.\n\n` +
          `Payout ID: ${payoutId}\n` +
          `Producer ID: ${safeStr(data.producerId)}\n` +
          `Email: ${safeStr(data.email)}\n` +
          `Amount: ${money(data.amount)}\n` +
          `Status: ${safeStr(data.status || "requested")}`,
        html: `
          <h2>New payout request</h2>
          <p><b>Payout ID:</b> ${payoutId}</p>
          <p><b>Producer ID:</b> ${safeStr(data.producerId)}</p>
          <p><b>Email:</b> ${safeStr(data.email) || "—"}</p>
          <p><b>Amount:</b> ${money(data.amount)}</p>
          <p><b>Status:</b> ${safeStr(data.status || "requested")}</p>
        `,
      });
    } catch (e) {
      console.error("onPayoutRequest email error:", e);
    }
  }
);

exports.onOrderPaid = onDocumentUpdated(
  {
    region: "us-central1",
    document: "orders/{orderId}",
    secrets: [RESEND_API_KEY, RESEND_FROM, ADMIN_NOTIFY_EMAIL],
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

      const adminTo = safeStr(ADMIN_NOTIFY_EMAIL.value());
      if (!adminTo) return;

      let beatTitle = "";
      try {
        const beatId = safeStr(after.beatId);
        if (beatId) {
          const beatSnap = await db.collection("beats").doc(beatId).get();
          if (beatSnap.exists) {
            const b = beatSnap.data() || {};
            beatTitle = safeStr(b.title || b.beatTitle || "");
          }
        }
      } catch (_) {}

      await sendEmail({
        to: adminTo,
        subject: "Beat purchase (PAID) on Audiory",
        text:
          `A buyer completed payment.\n\n` +
          `Order ID: ${orderId}\n` +
          `Beat ID: ${safeStr(after.beatId)}\n` +
          `Beat: ${beatTitle || "—"}\n` +
          `Amount: ${money(after.amount)}\n` +
          `Phone: ${safeStr(after.phone)}\n` +
          `Receipt: ${safeStr(after.receipt) || "—"}`,
        html: `
          <h2>Order paid ✅</h2>
          <p><b>Order ID:</b> ${orderId}</p>
          <p><b>Beat ID:</b> ${safeStr(after.beatId)}</p>
          <p><b>Beat:</b> ${beatTitle || "—"}</p>
          <p><b>Amount:</b> ${money(after.amount)}</p>
          <p><b>Phone:</b> ${safeStr(after.phone) || "—"}</p>
          <p><b>Receipt:</b> ${safeStr(after.receipt) || "—"}</p>
        `,
      });
    } catch (e) {
      console.error("onOrderPaid email error:", e);
    }
  }
);
