const { onCall, HttpsError } =
  require("firebase-functions/v2/https");

const admin =
  require("firebase-admin");

const db =
  admin.firestore();

function soundkitLimitForTier(tier){

  switch(String(tier || "free").toLowerCase()){

    case "starter":
      return 2;

    case "pro":
    case "elite":
      return Infinity;

    default:
      return 0;
  }
}

exports.publishKit =
  onCall(async (req)=>{

    const auth =
      req.auth;

    if(!auth?.uid){

      throw new HttpsError(
        "unauthenticated",
        "Login required"
      );

    }

    const uid =
      auth.uid;

    const data =
      req.data || {};

    const userSnap =
      await db
        .collection("users")
        .doc(uid)
        .get();

    const userData =
      userSnap.data() || {};

    const tier =
      String(
        userData.planTier ||
        userData.plan ||
        "free"
      ).toLowerCase();

    const limit =
      soundkitLimitForTier(tier);

    const kitsSnap =
      await db
        .collection("soundkits")
        .where("producerId","==",uid)
        .get();

    if(
      isFinite(limit) &&
      kitsSnap.size >= limit
    ){

      throw new HttpsError(
        "permission-denied",
        tier === "free"
          ? "Starter plan required for Sound Kits"
          : `Sound kit limit reached (${limit})`
      );

    }

    const payload = {

      title:
        String(data.title || "").trim(),

      description:
        String(data.description || "").trim(),

      category:
        String(data.category || "").trim(),

      price:
        Number(data.price || 0),

      cover:
        String(data.cover || "").trim(),

      previewAudioURL:
        String(data.previewAudioURL || "").trim(),

      downloadUrl:
        String(data.downloadUrl || "").trim(),

      producerId:
        uid,

      producerName:
        String(data.producerName || "").trim(),

      published:
        data.published === true,

      createdAt:
        Date.now(),

      updatedAt:
        Date.now()
    };

    const ref =
      await db
        .collection("soundkits")
        .add(payload);

    return {
      ok:true,
      id: ref.id
    };

  });

exports.updateKit =
  onCall(async (req)=>{

    const auth =
      req.auth;

    if(!auth?.uid){

      throw new HttpsError(
        "unauthenticated",
        "Login required"
      );

    }

    const uid =
      auth.uid;

    const data =
      req.data || {};

    const kitId =
      String(data.kitId || "").trim();

    if(!kitId){

      throw new HttpsError(
        "invalid-argument",
        "kitId required"
      );

    }

    const ref =
      db.collection("soundkits")
      .doc(kitId);

    const snap =
      await ref.get();

    if(!snap.exists){

      throw new HttpsError(
        "not-found",
        "Sound kit not found"
      );

    }

    const existing =
      snap.data() || {};

    if(existing.producerId !== uid){

      throw new HttpsError(
        "permission-denied",
        "Not your sound kit"
      );

    }

    await ref.update({

      title:
        String(data.title || "").trim(),

      description:
        String(data.description || "").trim(),

      category:
        String(data.category || "").trim(),

      price:
        Number(data.price || 0),

      cover:
        String(data.cover || "").trim(),

      previewAudioURL:
        String(data.previewAudioURL || "").trim(),

      downloadUrl:
        String(data.downloadUrl || "").trim(),

      published:
        data.published === true,

      updatedAt:
        Date.now()
    });

    return {
      ok:true
    };

  });
