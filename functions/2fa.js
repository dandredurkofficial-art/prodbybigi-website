const { onCall, HttpsError } =
require("firebase-functions/v2/https");

const { defineSecret } =
require("firebase-functions/params");

const admin =
require("firebase-admin");

const crypto =
require("crypto");

const { Resend } =
require("resend");

const RESEND_API_KEY =
defineSecret("RESEND_API_KEY");

const db =
admin.firestore();

/* =========================================================
   ENABLE 2FA
========================================================= */
exports.enable2FA = onCall(
  {
    cors: true
  },
  async (request) => {

    const auth = request.auth;

    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const userRef = db
      .collection("users")
      .doc(auth.uid);

    const userSnap =
      await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "User not found."
      );
    }

    await userRef.set(
      {
        twoFactorEnabled: true,
        twoFactorMethod: "email",
        twoFactorEnabledAt: Date.now()
      },
      { merge: true }
    );

    return {
      success: true,
      enabled: true
    };
  }
);

/* =========================================================
   DISABLE 2FA
========================================================= */
exports.disable2FA = onCall(
  {
    cors: true
  },
  async (request) => {

    const auth = request.auth;

    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const userRef = db
      .collection("users")
      .doc(auth.uid);

    const userSnap =
      await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "User not found."
      );
    }

    await userRef.set(
      {
        twoFactorEnabled: false,
        twoFactorDisabledAt: Date.now()
      },
      { merge: true }
    );

    return {
      success: true,
      enabled: false
    };
  }
);

/* =========================================================
   SEND 2FA CODE
========================================================= */
exports.send2FACode = onCall(
  {
    secrets: [RESEND_API_KEY],
    cors: true
  },
  async (request) => {

    const auth = request.auth;

    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const userSnap = await db
      .collection("users")
      .doc(auth.uid)
      .get();

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "User not found."
      );
    }

    const userData =
      userSnap.data() || {};

    const email = String(
      userData.email || ""
    )
      .trim()
      .toLowerCase();

    if (!email) {
      throw new HttpsError(
        "failed-precondition",
        "No email found."
      );
    }

    const code =
      Math.floor(
        100000 +
        Math.random() * 900000
      ).toString();

    const codeHash =
      crypto
        .createHash("sha256")
        .update(code)
        .digest("hex");

    await db
      .collection("twoFactorCodes")
      .add({
        uid: auth.uid,
        email,
        codeHash,
        used: false,
        createdAt: Date.now(),
        expiresAt:
          Date.now() +
          (5 * 60 * 1000)
      });

    const resend =
      new Resend(
        RESEND_API_KEY.value()
      );

    await resend.emails.send({
      from:
        "Audiory <noreply@mail.audiory.site>",

      to: email,

      subject:
        "Your Audiory Verification Code",

      html: `
      <div style="font-family:Arial,sans-serif;padding:20px;">
        <h2>
          Audiory Login Verification
        </h2>

        <p>
          Use this code to complete your login:
        </p>

        <div style="
          font-size:36px;
          font-weight:bold;
          letter-spacing:8px;
          margin:20px 0;
          color:#7c3aed;
        ">
          ${code}
        </div>

        <p>
          This code expires in 5 minutes.
        </p>

        <p>
          If you did not attempt to sign in,
          you can safely ignore this email.
        </p>
      </div>
      `
    });

    return {
      success: true
    };
  }
);

/* =========================================================
   VERIFY 2FA CODE
========================================================= */

exports.verify2FACode = onCall(
  {
    cors: true
  },
  async (request) => {

    const auth = request.auth;

    if (!auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in required."
      );
    }

    const code = String(
      request.data?.code || ""
    ).trim();

    if (!code) {
      throw new HttpsError(
        "invalid-argument",
        "Code required."
      );
    }

    const codeHash =
      crypto
        .createHash("sha256")
        .update(code)
        .digest("hex");

    const snap = await db
      .collection("twoFactorCodes")
      .where("uid", "==", auth.uid)
      .where("used", "==", false)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) {
      throw new HttpsError(
        "not-found",
        "No verification code found."
      );
    }

    const docRef = snap.docs[0];
    const data = docRef.data();

    if (Date.now() > data.expiresAt) {
      throw new HttpsError(
        "deadline-exceeded",
        "Code expired."
      );
    }

    if (data.codeHash !== codeHash) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid code."
      );
    }

    await docRef.ref.update({
      used: true,
      usedAt: Date.now()
    });

    return {
      success: true
    };
  }
);
