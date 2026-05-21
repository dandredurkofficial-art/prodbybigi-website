const { onCall, HttpsError } =
require("firebase-functions/v2/https");

const admin = require("firebase-admin");

const db = admin.firestore();

/* ===========================
   PLAN LIMITS
=========================== */

function beatLimitForTier(tier){

  switch(String(tier || "free").toLowerCase()){

    case "starter":
      return 50;

    case "pro":
    case "elite":
      return Infinity;

    default:
      return 10;
  }
}

/* ===========================
   PUBLISH BEAT
=========================== */

exports.publishBeat = onCall(
  {
    region: "us-central1",
  },

  async (request) => {

    const auth = request.auth;

    if(!auth){

      throw new HttpsError(
        "unauthenticated",
        "Login required"
      );

    }

    const uid = auth.uid;

    const data =
      request.data || {};

    /* ===========================
       USER PROFILE
    ============================ */

    const userSnap =
      await db.collection("users")
      .doc(uid)
      .get();

    if(!userSnap.exists){

      throw new HttpsError(
        "not-found",
        "User profile not found"
      );

    }

    const user =
      userSnap.data() || {};

    const tier =
      String(user.planTier || "free")
      .toLowerCase();

    /* ===========================
       UPLOAD LIMIT
    ============================ */

    const limit =
      beatLimitForTier(tier);

    if(isFinite(limit)){

      const beatsSnap =
        await db.collection("beats")
        .where("producerId","==",uid)
        .get();

      if(beatsSnap.size >= limit){

        throw new HttpsError(
          "permission-denied",
          `Upload limit reached (${beatsSnap.size}/${limit})`
        );

      }
    }

    /* ===========================
       VALIDATION
    ============================ */

    if(!data.title){

      throw new HttpsError(
        "invalid-argument",
        "Beat title required"
      );

    }

    if(!data.fullAudio){

      throw new HttpsError(
        "invalid-argument",
        "Full audio missing"
      );

    }

    if(!data.previewAudio){

      throw new HttpsError(
        "invalid-argument",
        "Preview audio missing"
      );

    }

    /* ===========================
       ELITE PREMIERE CHECK
    ============================ */

    if(
      data.isPremiere === true &&
      tier !== "elite"
    ){

      throw new HttpsError(
        "permission-denied",
        "Beat Premieres are Elite only"
      );

    }

    /* ===========================
       SECURE PAYLOAD
    ============================ */

    const payload = {

      ...data,

      producerId: uid,

      producerName:
        String(
          data.producerName || ""
        ).trim(),

      createdAt:
        data.createdAt || Date.now(),

      updatedAt:
        Date.now(),

      plays:
        Number(data.plays || 0)

    };

    /* ===========================
       CREATE DOC
    ============================ */

    const ref =
      await db.collection("beats")
      .add(payload);

    return {

      ok: true,
      beatId: ref.id

    };

  }
);

/* ===========================
   UPDATE BEAT
=========================== */

exports.updateBeat = onCall(
  {
    region: "us-central1",
  },

  async (request) => {

    const auth =
      request.auth;

    if(!auth){

      throw new HttpsError(
        "unauthenticated",
        "Login required"
      );

    }

    const uid =
      auth.uid;

    const data =
      request.data || {};

    const beatId =
      String(data.beatId || "");

    if(!beatId){

      throw new HttpsError(
        "invalid-argument",
        "beatId required"
      );

    }

    const beatRef =
      db.collection("beats")
      .doc(beatId);

    const beatSnap =
      await beatRef.get();

    if(!beatSnap.exists){

      throw new HttpsError(
        "not-found",
        "Beat not found"
      );

    }

    const beat =
      beatSnap.data() || {};

    if(beat.producerId !== uid){

      throw new HttpsError(
        "permission-denied",
        "Not your beat"
      );

    }

    const userSnap =
      await db.collection("users")
      .doc(uid)
      .get();

    const user =
      userSnap.data() || {};

    const tier =
      String(user.planTier || "free")
      .toLowerCase();

    if(
      data.isPremiere === true &&
      tier !== "elite"
    ){

      throw new HttpsError(
        "permission-denied",
        "Beat Premieres are Elite only"
      );

    }

    delete data.producerId;
    delete data.createdAt;
    delete data.plays;

    await beatRef.update({

      ...data,

      updatedAt: Date.now()

    });

    return {

      ok: true

    };

  }
);
