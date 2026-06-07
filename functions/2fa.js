const { onCall, HttpsError } =
require("firebase-functions/v2/https");

const admin =
require("firebase-admin");

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
