const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const db = admin.firestore();

/* =====================================
   Generate Random Referral Code
===================================== */

function randomCode(length = 5) {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

    for (let i = 0; i < length; i++) {

        code += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );

    }

    return `AUDIO-${code}`;

}

/* =====================================
   Create Unique Referral Code
===================================== */

async function createUniqueReferralCode() {

    let code;

    let exists = true;

    while (exists) {

        code = randomCode();

        const snap = await db
            .collection("users")
            .where("referralCode", "==", code)
            .limit(1)
            .get();

        exists = !snap.empty;

    }

    return code;

}

/* =====================================
   Generate User Referral Code
===================================== */

exports.generateReferralCode = onCall(async (request) => {

    if (!request.auth) {

        throw new HttpsError(
            "unauthenticated",
            "Login required."
        );

    }

    const uid = request.auth.uid;

    const userRef =
        db.collection("users").doc(uid);

    const user =
        await userRef.get();

    if (!user.exists) {

        throw new HttpsError(
            "not-found",
            "Producer not found."
        );

    }

    const data = user.data();

    // Already has one

    if (data.referralCode) {

        return {

            success: true,

            referralCode:
                data.referralCode

        };

    }

    const referralCode =
        await createUniqueReferralCode();

    await userRef.update({

        referralCode

    });

    return {

        success: true,

        referralCode

    };

});

/* =====================================
   Dashboard Data
===================================== */

exports.getReferralDashboard = onCall(async (request) => {

    if (!request.auth) {

        throw new HttpsError(
            "unauthenticated",
            "Login required."
        );

    }

    const uid = request.auth.uid;

    const user =
        await db.collection("users")
        .doc(uid)
        .get();

    if (!user.exists) {

        throw new HttpsError(
            "not-found",
            "User not found."
        );

    }

    const data = user.data();

    return {

        referralCode:
            data.referralCode || null,

        boostCredits:
            data.boostCredits || 0,

        pendingReferrals:
            data.pendingReferrals || 0,

        qualifiedReferrals:
            data.qualifiedReferrals || 0

    };

});

exports.applyReferral = onCall(async (request) => {

    if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "Login required."
        );
    }

    const uid = request.auth.uid;

    const referralCode =
        String(request.data?.referralCode || "")
        .trim()
        .toUpperCase();

    // User didn't use a referral link.
    if (!referralCode) {

        return {
            success: true,
            skipped: true
        };

    }

    const userRef =
        db.collection("users").doc(uid);

    const userSnap =
        await userRef.get();

    if (!userSnap.exists) {

        throw new HttpsError(
            "not-found",
            "User not found."
        );

    }

    const user =
        userSnap.data();

    // Already referred
    if (user.referredBy) {

        return {
            success: true,
            skipped: true
        };

    }

    // Find owner of referral code

    const refSnap =
        await db.collection("users")
        .where("referralCode","==",referralCode)
        .limit(1)
        .get();

    if (refSnap.empty) {

        return {
            success:false,
            reason:"invalid-code"
        };

    }

    const referrerDoc =
        refSnap.docs[0];

    // Prevent self referral

    if (referrerDoc.id === uid) {

        return {
            success:false,
            reason:"self-referral"
        };

    }

    const batch = db.batch();

    // Mark who referred this user
    batch.set(userRef, {
      referredBy: referrerDoc.id
    }, { merge: true });

    // Safely update the referrer stats
    batch.set(referrerDoc.ref, {
      pendingReferrals: admin.firestore.FieldValue.increment(1),
      qualifiedReferrals: admin.firestore.FieldValue.increment(0),
      boostCredits: admin.firestore.FieldValue.increment(0)
    }, { merge: true });

    // Create referral record
    const referralRef = db.collection("referrals").doc();

    batch.set(referralRef, {
      referrerId: referrerDoc.id,
      referredId: uid,
      referralCode,
      status: "pending",
      rewardIssued: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    return{

        success:true

    };

});

/* =====================================
   QUALIFY REFERRAL
===================================== */

exports.qualifyReferral = async function qualifyReferral(uid) {

    // Find pending referral
    const referralSnap =
        await db.collection("referrals")
        .where("referredId", "==", uid)
        .where("status", "==", "pending")
        .limit(1)
        .get();

    if (referralSnap.empty) {

        return false;

    }

    const referralDoc =
        referralSnap.docs[0];

    const referralRef =
        referralDoc.ref;

    const creditRef =
        db.collection("creditTransactions").doc();

    await db.runTransaction(async (transaction) => {

        const referralSnapshot =
            await transaction.get(referralRef);

        if (!referralSnapshot.exists) {

            throw new Error("Referral not found.");

        }

        const referral =
            referralSnapshot.data();

        // Already rewarded
        if (
            referral.rewardIssued === true ||
            referral.status === "qualified"
        ) {

            return;

        }

        const referrerRef =
            db.collection("users")
            .doc(referral.referrerId);

        // Mark referral as qualified
        transaction.update(referralRef, {

            status: "qualified",

            rewardIssued: true,

            qualifiedAt:
                admin.firestore.FieldValue.serverTimestamp()

        });

        // Update referrer stats
        transaction.set(referrerRef, {

            pendingReferrals:
                admin.firestore.FieldValue.increment(-1),

            qualifiedReferrals:
                admin.firestore.FieldValue.increment(1),

            boostCredits:
                admin.firestore.FieldValue.increment(10)

        }, { merge: true });

        // Credit ledger
        transaction.set(creditRef, {

            userId:
                referral.referrerId,

            credits: 10,

            type: "earn",

            reason: "referral_qualified",

            referredUserId: uid,

            referralId:
                referralRef.id,

            createdAt:
                admin.firestore.FieldValue.serverTimestamp()

        });

    });

    return true;

};
