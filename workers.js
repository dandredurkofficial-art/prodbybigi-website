const FIREBASE_PROJECT_ID = "audiory-beat-store";

const FIREBASE_ISSUER =
  `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

const FIREBASE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const ALLOWED_ORIGINS = [
  "https://audiory.site",
  "https://www.audiory.site",
  "https://storage.audiory.site"
];


// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    const origin =
      request.headers.get("Origin") || "";

    const corsOrigin =
      ALLOWED_ORIGINS.includes(origin)
        ? origin
        : "https://audiory.site";

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods":
        "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Vary": "Origin"
    };


    // --------------------------------------------------------
    // CORS
    // --------------------------------------------------------

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }


    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return json(
        {
          success: true,
          service: "audiory-storage",
          storage: "cloudflare-r2",
          authentication: "firebase"
        },
        200,
        corsHeaders
      );
    }


    // --------------------------------------------------------
    // UPLOAD
    // PUT /upload/<key>
    // --------------------------------------------------------

    if (
      request.method === "PUT" &&
      url.pathname.startsWith("/upload/")
    ) {

      const key =
        decodeURIComponent(
          url.pathname.substring(
            "/upload/".length
          )
        );


      if (!key) {
        return json(
          {
            success: false,
            error: "Missing file path"
          },
          400,
          corsHeaders
        );
      }


      // Authenticate Firebase user
      const user =
        await authenticateFirebaseUser(
          request
        );


      if (!user) {
        return json(
          {
            success: false,
            error: "Authentication required"
          },
          401,
          corsHeaders
        );
      }


      const uid =
        user.sub;


      // ------------------------------------------------------
      // Validate path
      // ------------------------------------------------------

      if (
        key.includes("..") ||
        key.startsWith("/") ||
        key.includes("\\")
      ) {
        return json(
          {
            success: false,
            error: "Invalid storage path"
          },
          400,
          corsHeaders
        );
      }


      // ------------------------------------------------------
      // Ensure UID exists as an actual path segment
      // ------------------------------------------------------

      const pathParts =
        key.split("/");

      if (!pathParts.includes(uid)) {
        return json(
          {
            success: false,
            error:
              "You can only upload files to your own storage directory"
          },
          403,
          corsHeaders
        );
      }


      const contentType =
        request.headers.get(
          "content-type"
        ) ||
        "application/octet-stream";


      // ------------------------------------------------------
      // R2 UPLOAD
      // ------------------------------------------------------

      await env.AUDIO_R2.put(
        key,
        request.body,
        {
          httpMetadata: {
            contentType
          }
        }
      );


      return json(
        {
          success: true,
          key,
          storagePath: key,

          downloadURL:
            `${url.origin}/file/${encodeURIComponent(key)}`,

          message:
            "File uploaded successfully"
        },
        200,
        corsHeaders
      );
    }


    // --------------------------------------------------------
    // GET FILE
    // GET /file/<key>
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/file/")
    ) {

      const key =
        decodeURIComponent(
          url.pathname.substring(
            "/file/".length
          )
        );


      if (!key) {
        return json(
          {
            success: false,
            error: "Missing file path"
          },
          400,
          corsHeaders
        );
      }


      const object =
        await env.AUDIO_R2.get(key);


      if (!object) {
        return json(
          {
            success: false,
            error: "File not found"
          },
          404,
          corsHeaders
        );
      }


      const headers =
        new Headers(corsHeaders);


      object.writeHttpMetadata(
        headers
      );


      headers.set(
        "ETag",
        object.httpEtag
      );


      headers.set(
        "Cache-Control",
        "public, max-age=31536000"
      );


      return new Response(
        object.body,
        {
          status: 200,
          headers
        }
      );
    }


    // --------------------------------------------------------
    // DELETE
    // DELETE /file/<key>
    // --------------------------------------------------------

    if (
      request.method === "DELETE" &&
      url.pathname.startsWith("/file/")
    ) {

      const key =
        decodeURIComponent(
          url.pathname.substring(
            "/file/".length
          )
        );


      if (!key) {
        return json(
          {
            success: false,
            error: "Missing file path"
          },
          400,
          corsHeaders
        );
      }


      const user =
        await authenticateFirebaseUser(
          request
        );


      if (!user) {
        return json(
          {
            success: false,
            error: "Authentication required"
          },
          401,
          corsHeaders
        );
      }


      const uid =
        user.sub;


      const pathParts =
        key.split("/");


      if (!pathParts.includes(uid)) {
        return json(
          {
            success: false,
            error:
              "You can only delete your own files"
          },
          403,
          corsHeaders
        );
      }


      await env.AUDIO_R2.delete(
        key
      );


      return json(
        {
          success: true,
          key,
          message:
            "File deleted successfully"
        },
        200,
        corsHeaders
      );
    }

    // ========================================================
    // FIRESTORE BACKEND FUNCTIONS
    // ========================================================

    // POST /api/publishBeat
    if (
      request.method === "POST" &&
      url.pathname === "/api/publishBeat"
    ) {
      try {
        return await handlePublishBeat(
          request,
          corsHeaders
        );
      } catch (error) {

        console.error(
          "publishBeat ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "publishBeat backend error"
          },
          500,
          corsHeaders
        );
      }
    }


    // POST /api/updateBeat
    if (
      request.method === "POST" &&
      url.pathname === "/api/updateBeat"
    ) {
      try {
        return await handleUpdateBeat(
          request,
          corsHeaders
        );
      } catch (error) {

        console.error(
          "updateBeat ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "updateBeat backend error"
          },
          500,
          corsHeaders
        );
      }
    }


    if (
      request.method === "POST" &&
      url.pathname === "/api/publishKit"
    ) {
      try {
        return await handlePublishKit(
          request,
          corsHeaders
        );
      } catch (error) {

        console.error(
          "publishKit ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "publishKit backend error"
          },
          500,
          corsHeaders
        );
      }
    }


    if (
      request.method === "POST" &&
      url.pathname === "/api/updateKit"
    ) {
      try {
        return await handleUpdateKit(
          request,
          corsHeaders
        );
      } catch (error) {

        console.error(
          "updateKit ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "updateKit backend error"
          },
          500,
          corsHeaders
        );
      }
    }

    // ========================================================
    // SECURE BEAT DOWNLOAD
    // POST /api/secureDownload
    // ========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/secureDownload"
    ) {

      try {

        return await handleSecureDownload(
          request,
          env,
          corsHeaders
        );

      } catch (error) {

        console.error(
          "secureDownload ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "Secure download failed"
          },
          500,
          corsHeaders
        );

      }

    }

    // ========================================================
    // SECURE SOUND-KIT DOWNLOAD
    // POST /api/secureKitDownload
    // ========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/secureKitDownload"
    ) {
      try {
        return await handleSecureKitDownload(
          request,
          env,
          corsHeaders
        );
      } catch (error) {
        console.error(
          "secureKitDownload ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "Secure sound-kit download failed"
          },
          500,
          corsHeaders
        );
      }
    }

    // ========================================================
    // SECURE LICENSE DOWNLOAD
    // POST /api/licenseDownload
    // ========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/licenseDownload"
    ) {
      try {
        return await handleLicenseDownload(
          request,
          env,
          corsHeaders
        );
      } catch (error) {
        console.error(
          "licenseDownload ERROR:",
          error
        );

        return json(
          {
            success: false,
            error:
              error?.message ||
              "License download failed"
          },
          500,
          corsHeaders
        );
      }
    }


    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    return json(
      {
        success: false,
        error: "Route not found"
      },
      404,
      corsHeaders
    );
  }
};


// ============================================================
// AUTHENTICATE FIREBASE USER
// ============================================================

async function authenticateFirebaseUser(
  request
) {

  const authorization =
    request.headers.get(
      "Authorization"
    );


  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }


  const token =
    authorization
      .slice(7)
      .trim();


  if (!token) {
    return null;
  }


  try {

    return await verifyFirebaseIdToken(
      token
    );

  } catch (error) {

    console.error(
      "Firebase token verification failed:",
      error?.message || error
    );

    return null;
  }
}


// ============================================================
// VERIFY FIREBASE ID TOKEN
// ============================================================

async function verifyFirebaseIdToken(
  token
) {

  const parts =
    token.split(".");


  if (parts.length !== 3) {
    throw new Error(
      "Invalid JWT format"
    );
  }


  const [
    encodedHeader,
    encodedPayload,
    encodedSignature
  ] = parts;


  const header =
    JSON.parse(
      base64UrlDecode(
        encodedHeader
      )
    );


  const payload =
    JSON.parse(
      base64UrlDecode(
        encodedPayload
      )
    );


  // ----------------------------------------------------------
  // Header checks
  // ----------------------------------------------------------

  if (
    header.alg !== "RS256"
  ) {
    throw new Error(
      "Invalid JWT algorithm"
    );
  }


  if (!header.kid) {
    throw new Error(
      "Missing JWT kid"
    );
  }


  // ----------------------------------------------------------
  // Firebase claim checks
  // ----------------------------------------------------------

  if (
    payload.aud !==
    FIREBASE_PROJECT_ID
  ) {
    throw new Error(
      "Invalid Firebase audience"
    );
  }


  if (
    payload.iss !==
    FIREBASE_ISSUER
  ) {
    throw new Error(
      "Invalid Firebase issuer"
    );
  }


  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    throw new Error(
      "Invalid Firebase UID"
    );
  }


  const now =
    Math.floor(
      Date.now() / 1000
    );


  if (
    typeof payload.exp !== "number" ||
    payload.exp <= now
  ) {
    throw new Error(
      "Firebase token expired"
    );
  }


  if (
    typeof payload.iat !== "number" ||
    payload.iat > now
  ) {
    throw new Error(
      "Invalid Firebase issued-at time"
    );
  }


  if (
    typeof payload.auth_time === "number" &&
    payload.auth_time > now
  ) {
    throw new Error(
      "Invalid Firebase auth_time"
    );
  }


  // ----------------------------------------------------------
  // Get Google's Firebase signing keys
  // ----------------------------------------------------------

  const keys =
    await getFirebaseJWKs();


  const jwk =
    keys.find(
      key =>
        key.kid === header.kid
    );


  if (!jwk) {
    throw new Error(
      "Firebase signing key not found"
    );
  }


  // ----------------------------------------------------------
  // Import RSA JWK
  // ----------------------------------------------------------

  const cryptoKey =
    await crypto.subtle.importKey(
      "jwk",

      {
        kty: "RSA",
        n: jwk.n,
        e: jwk.e,
        alg: "RS256",
        use: "sig"
      },

      {
        name:
          "RSASSA-PKCS1-v1_5",
        hash:
          "SHA-256"
      },

      false,

      ["verify"]
    );


  // ----------------------------------------------------------
  // Verify signature
  // ----------------------------------------------------------

  const signature =
    base64UrlToUint8Array(
      encodedSignature
    );


  const signedData =
    new TextEncoder().encode(
      `${encodedHeader}.${encodedPayload}`
    );


  const valid =
    await crypto.subtle.verify(
      {
        name:
          "RSASSA-PKCS1-v1_5"
      },

      cryptoKey,

      signature,

      signedData
    );


  if (!valid) {
    throw new Error(
      "Invalid Firebase token signature"
    );
  }


  return payload;
}


// ============================================================
// FIREBASE JWK CACHE
// ============================================================

let firebaseJWKCache = null;

let firebaseJWKExpiresAt = 0;


async function getFirebaseJWKs() {

  const now =
    Date.now();


  if (
    firebaseJWKCache &&
    now <
      firebaseJWKExpiresAt
  ) {
    return firebaseJWKCache;
  }


  const response =
    await fetch(
      FIREBASE_JWK_URL
    );


  if (!response.ok) {
    throw new Error(
      `Firebase JWK request failed: ${response.status}`
    );
  }


  const data =
    await response.json();


  if (
    !data ||
    !Array.isArray(data.keys)
  ) {
    throw new Error(
      "Invalid Firebase JWK response"
    );
  }


  firebaseJWKCache =
    data.keys;


  // Cache for 1 hour.
  // Firebase key rotation is handled by
  // refreshing this cache periodically.
  firebaseJWKExpiresAt =
    now + 60 * 60 * 1000;


  return firebaseJWKCache;
}


// ============================================================
// BASE64URL HELPERS
// ============================================================

function base64UrlDecode(
  value
) {

  return new TextDecoder().decode(
    base64UrlToUint8Array(
      value
    )
  );
}


function base64UrlToUint8Array(
  value
) {

  let base64 =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/");


  while (
    base64.length % 4
  ) {
    base64 += "=";
  }


  const binary =
    atob(base64);


  const bytes =
    new Uint8Array(
      binary.length
    );


  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }


  return bytes;
}


// ============================================================
// JSON
// ============================================================

function json(
  data,
  status = 200,
  extraHeaders = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json",

        ...extraHeaders
      }
    }
  );
}

// ========================================================
// AUDIOry FIRESTORE CONFIG
// ========================================================

const FIRESTORE_PROJECT =
  "audiory-beat-store";

const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;


// ========================================================
// FIREBASE AUTH
// ========================================================

async function getAuthenticatedUser(request) {

  const authorization =
    request.headers.get("Authorization") || "";

  if (
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  if (!token) {
    return null;
  }

  try {

    const user =
      await verifyFirebaseIdToken(token);

    return user;

  } catch (error) {

    console.error(
      "Backend Firebase authentication failed:",
      error?.message || error
    );

    return null;
  }
}


// ========================================================
// FIRESTORE FETCH
// ========================================================

async function firestoreRequest(
  path,
  token,
  options = {}
) {

  const response =
    await fetch(
      `${FIRESTORE_BASE}${path}`,
      {
        ...options,

        headers: {
          "Authorization":
            `Bearer ${token}`,

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {
      raw: text
    };

  }

  if (!response.ok) {

    console.error(
      "Firestore error:",
      response.status,
      data
    );

    throw new Error(
      data?.error?.message ||
      `Firestore request failed (${response.status})`
    );
  }

  return data;
}


// ========================================================
// FIRESTORE VALUE CONVERTER
// ========================================================

function toFirestoreValue(value) {

  if (value === null) {

    return {
      nullValue: null
    };

  }


  if (typeof value === "string") {

    return {
      stringValue: value
    };

  }


  if (typeof value === "boolean") {

    return {
      booleanValue: value
    };

  }


  if (
    typeof value === "number"
  ) {

    if (
      Number.isInteger(value)
    ) {

      return {
        integerValue:
          String(value)
      };

    }

    return {
      doubleValue: value
    };

  }


  if (Array.isArray(value)) {

    return {

      arrayValue: {

        values:
          value.map(
            toFirestoreValue
          )

      }

    };

  }


  if (
    typeof value === "object"
  ) {

    const fields = {};

    for (
      const [key, val]
      of Object.entries(value)
    ) {

      fields[key] =
        toFirestoreValue(val);

    }

    return {

      mapValue: {
        fields
      }

    };

  }


  return {
    nullValue: null
  };
}


// ========================================================
// FIRESTORE DOCUMENT CONVERTER
// ========================================================

function toFirestoreFields(data) {

  const fields = {};

  for (
    const [key, value]
    of Object.entries(data)
  ) {

    fields[key] =
      toFirestoreValue(value);

  }

  return fields;
}


// ========================================================
// FIRESTORE VALUE READER
// ========================================================

function fromFirestoreValue(value) {

  if (!value) {
    return null;
  }


  if (
    "stringValue" in value
  ) {
    return value.stringValue;
  }


  if (
    "integerValue" in value
  ) {
    return Number(
      value.integerValue
    );
  }


  if (
    "doubleValue" in value
  ) {
    return value.doubleValue;
  }


  if (
    "booleanValue" in value
  ) {
    return value.booleanValue;
  }


  if (
    "nullValue" in value
  ) {
    return null;
  }


  if (
    "arrayValue" in value
  ) {

    return (
      value.arrayValue.values || []
    ).map(
      fromFirestoreValue
    );

  }


  if (
    "mapValue" in value
  ) {

    const result = {};

    for (
      const [key, val]
      of Object.entries(
        value.mapValue.fields || {}
      )
    ) {

      result[key] =
        fromFirestoreValue(val);

    }

    return result;
  }


  if (
    "timestampValue" in value
  ) {

    return value.timestampValue;

  }


  return null;
}


// ========================================================
// FIRESTORE DOCUMENT READER
// ========================================================

function fromFirestoreDocument(
  document
) {

  const result = {};

  for (
    const [key, value]
    of Object.entries(
      document?.fields || {}
    )
  ) {

    result[key] =
      fromFirestoreValue(value);

  }

  return result;
}


// ========================================================
// GET FIRESTORE DOCUMENT
// ========================================================

async function getFirestoreDocument(
  collection,
  id,
  token
) {

  try {

    const document =
      await firestoreRequest(
        `/${collection}/${encodeURIComponent(id)}`,
        token
      );

    return {
      exists: true,
      id,
      data:
        fromFirestoreDocument(
          document
        )
    };

  } catch (error) {

    if (
      String(error.message)
        .includes("NOT_FOUND")
    ) {

      return {
        exists: false,
        id,
        data: null
      };

    }

    throw error;
  }
}


// ========================================================
// QUERY FIRESTORE
// ========================================================

async function queryFirestore(
  collection,
  field,
  operator,
  value,
  token,
  limit = 100
) {

  const body = {

    structuredQuery: {

      from: [
        {
          collectionId:
            collection
        }
      ],

      where: {

        fieldFilter: {

          field: {
            fieldPath:
              field
          },

          op:
            operator,

          value:
            toFirestoreValue(value)

        }

      },

      limit

    }

  };


  const response =
    await firestoreRequest(
      ":runQuery",
      token,
      {
        method: "POST",
        body:
          JSON.stringify(body)
      }
    );


  return (
    Array.isArray(response)
      ? response
      : []
  )
    .filter(
      item => item.document
    )
    .map(
      item => ({
        id:
          item.document.name
            .split("/")
            .pop(),

        data:
          fromFirestoreDocument(
            item.document
          )
      })
    );
}


// ========================================================
// CREATE FIRESTORE DOCUMENT
// ========================================================

async function createFirestoreDocument(
  collection,
  data,
  token
) {

  const document =
    await firestoreRequest(
      `/${collection}`,
      token,
      {
        method: "POST",

        body:
          JSON.stringify({
            fields:
              toFirestoreFields(
                data
              )
          })
      }
    );


  return {
    id:
      document.name
        .split("/")
        .pop(),

    data:
      fromFirestoreDocument(
        document
      )
  };
}


// ========================================================
// UPDATE FIRESTORE DOCUMENT
// ========================================================

async function updateFirestoreDocument(
  collection,
  id,
  data,
  token
) {

  const fieldNames =
    Object.keys(data);


  const updateMask =
    fieldNames
      .map(
        field =>
          `updateMask.fieldPaths=${encodeURIComponent(field)}`
      )
      .join("&");


  const fields =
    toFirestoreFields(
      data
    );


  return await firestoreRequest(
    `/${collection}/${encodeURIComponent(id)}?${updateMask}`,
    token,
    {
      method: "PATCH",

      body:
        JSON.stringify({
          fields
        })
    }
  );
}

async function setFirestoreDocument(
  collection,
  id,
  data,
  token
) {

  const documentName =
    `projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${collection}/${id}`;


  const body = {

    writes: [

      {

        update: {

          name:
            documentName,

          fields:
            toFirestoreFields(
              data
            )

        }

      }

    ]

  };


  return await firestoreRequest(
    ":commit",
    token,
    {
      method: "POST",

      body:
        JSON.stringify(body)
    }
  );
}


// ========================================================
// PUBLISH BEAT
// ========================================================

async function handlePublishBeat(
  request,
  corsHeaders
) {

  const user =
    await getAuthenticatedUser(
      request
    );


  if (!user) {

    return json(
      {
        success: false,
        error:
          "Authentication required"
      },
      401,
      corsHeaders
    );

  }


  const uid =
    user.sub;


  let data;

  try {

    data =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error:
          "Invalid JSON body"
      },
      400,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // USER PROFILE
  // ------------------------------------------------------

  const userDoc =
    await getFirestoreDocument(
      "users",
      uid,
      request.headers.get(
        "Authorization"
      ).slice(7)
    );


  if (!userDoc.exists) {

    return json(
      {
        success: false,
        error:
          "User profile not found"
      },
      404,
      corsHeaders
    );

  }


  const userData =
    userDoc.data || {};


  const tier =
    String(
      userData.planTier ||
      "free"
    ).toLowerCase();


  // ------------------------------------------------------
  // PLAN LIMIT
  // ------------------------------------------------------

  let limit = 10;

  if (tier === "starter") {
    limit = 50;
  }

  if (
    tier === "pro" ||
    tier === "elite"
  ) {
    limit = Infinity;
  }


  if (Number.isFinite(limit)) {

    const existing =
      await queryFirestore(
        "beats",
        "producerId",
        "EQUAL",
        uid,
        request.headers
          .get("Authorization")
          .slice(7),
        limit + 1
      );


    if (
      existing.length >= limit
    ) {

      return json(
        {
          success: false,
          error:
            `Upload limit reached (${existing.length}/${limit})`
        },
        403,
        corsHeaders
      );

    }

  }


  // ------------------------------------------------------
  // VALIDATION
  // ------------------------------------------------------

  if (!data.title) {

    return json(
      {
        success: false,
        error:
          "Beat title required"
      },
      400,
      corsHeaders
    );

  }


  if (!data.fullAudio) {

    return json(
      {
        success: false,
        error:
          "Full audio missing"
      },
      400,
      corsHeaders
    );

  }


  if (!data.previewAudio) {

    return json(
      {
        success: false,
        error:
          "Preview audio missing"
      },
      400,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // PREMIERE
  // ------------------------------------------------------

  if (
    data.isPremiere === true &&
    tier !== "elite"
  ) {

    return json(
      {
        success: false,
        error:
          "Beat Premieres are Elite only"
      },
      403,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // SECURE PAYLOAD
  // ------------------------------------------------------

  const payload = {

    ...data,

    producerId:
      uid,

    producerName:
      String(
        data.producerName || ""
      ).trim(),

    createdAt:
      data.createdAt ||
      Date.now(),

    updatedAt:
      Date.now(),

    plays:
      Number(
        data.plays || 0
      )

  };


  // Never allow these to be controlled
  // by the client.

  payload.producerId = uid;


  // ------------------------------------------------------
  // CREATE BEAT
  // ------------------------------------------------------

  const created =
    await createFirestoreDocument(
      "beats",
      payload,
      request.headers
        .get("Authorization")
        .slice(7)
    );


  // ------------------------------------------------------
// UPDATE PRODUCER STATS
//
// The original Firebase function used:
// producerRef.set(..., { merge: true })
//
// That means the producer document should be created
// automatically if it doesn't exist.
// ------------------------------------------------------

const producerToken =
  request.headers
    .get("Authorization")
    .slice(7);


let currentCount = 0;


// Try to read the existing producer document.
// It is okay if it doesn't exist.
const producerDoc =
  await getFirestoreDocument(
    "producers",
    uid,
    producerToken
  );


if (producerDoc.exists) {

  currentCount =
    Number(
      producerDoc.data?.beatsCount || 0
    );

}


const newCount =
  currentCount + 1;


// IMPORTANT:
// updateFirestoreDocument() currently uses PATCH,
// which fails when a document does not exist.
//
// So use a dedicated SET/MERGE request.
await setFirestoreDocument(
  "producers",
  uid,
  {
    beatsCount:
      newCount
  },
  producerToken
);


  return json(
    {
      success: true,

      ok: true,

      beatId:
        created.id,

      beatsCount:
        newCount
    },
    200,
    corsHeaders
  );
}


// ========================================================
// UPDATE BEAT
// ========================================================

async function handleUpdateBeat(
  request,
  corsHeaders
) {

  const user =
    await getAuthenticatedUser(
      request
    );


  if (!user) {

    return json(
      {
        success: false,
        error:
          "Authentication required"
      },
      401,
      corsHeaders
    );

  }


  const uid =
    user.sub;


  let data;

  try {

    data =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error:
          "Invalid JSON body"
      },
      400,
      corsHeaders
    );

  }


  const beatId =
    String(
      data.beatId || ""
    ).trim();


  if (!beatId) {

    return json(
      {
        success: false,
        error:
          "beatId required"
      },
      400,
      corsHeaders
    );

  }


  const token =
    request.headers
      .get("Authorization")
      .slice(7);


  const beat =
    await getFirestoreDocument(
      "beats",
      beatId,
      token
    );


  if (!beat.exists) {

    return json(
      {
        success: false,
        error:
          "Beat not found"
      },
      404,
      corsHeaders
    );

  }


  if (
    beat.data?.producerId !== uid
  ) {

    return json(
      {
        success: false,
        error:
          "Not your beat"
      },
      403,
      corsHeaders
    );

  }


  const userDoc =
    await getFirestoreDocument(
      "users",
      uid,
      token
    );


  const tier =
    String(
      userDoc.data?.planTier ||
      "free"
    ).toLowerCase();


  if (
    data.isPremiere === true &&
    tier !== "elite"
  ) {

    return json(
      {
        success: false,
        error:
          "Beat Premieres are Elite only"
      },
      403,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // Never allow ownership/history fields
  // to be changed.
  // ------------------------------------------------------

  delete data.beatId;
  delete data.producerId;
  delete data.createdAt;
  delete data.plays;


  data.updatedAt =
    Date.now();


  await updateFirestoreDocument(
    "beats",
    beatId,
    data,
    token
  );


  return json(
    {
      success: true,
      ok: true
    },
    200,
    corsHeaders
  );
}


// ========================================================
// PUBLISH SOUND KIT
// ========================================================

async function handlePublishKit(
  request,
  corsHeaders
) {

  const user =
    await getAuthenticatedUser(
      request
    );


  if (!user) {

    return json(
      {
        success: false,
        error:
          "Authentication required"
      },
      401,
      corsHeaders
    );

  }


  const uid =
    user.sub;


  const token =
    request.headers
      .get("Authorization")
      .slice(7);


  let data;

  try {

    data =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error:
          "Invalid JSON body"
      },
      400,
      corsHeaders
    );

  }


  const userDoc =
    await getFirestoreDocument(
      "users",
      uid,
      token
    );


  const userData =
    userDoc.data || {};


  const tier =
    String(
      userData.planTier ||
      userData.plan ||
      "free"
    ).toLowerCase();


  let limit = 0;

  if (tier === "starter") {
    limit = 2;
  }

  if (
    tier === "pro" ||
    tier === "elite"
  ) {
    limit = Infinity;
  }


  const existing =
    await queryFirestore(
      "soundkits",
      "producerId",
      "EQUAL",
      uid,
      token,
      Number.isFinite(limit)
        ? limit + 1
        : 100
    );


  if (
    Number.isFinite(limit) &&
    existing.length >= limit
  ) {

    return json(
      {
        success: false,
        error:
          tier === "free"
            ? "Starter plan required for Sound Kits"
            : `Sound kit limit reached (${limit})`
      },
      403,
      corsHeaders
    );

  }


  const payload = {

    title:
      String(
        data.title || ""
      ).trim(),

    description:
      String(
        data.description || ""
      ).trim(),

    category:
      String(
        data.category || ""
      ).trim(),

    price:
      Number(
        data.price || 0
      ),

    cover:
      String(
        data.cover || ""
      ).trim(),

    previewAudioURL:
      String(
        data.previewAudioURL || ""
      ).trim(),

    downloadUrl:
      String(
        data.downloadUrl || ""
      ).trim(),

    producerId:
      uid,

    producerName:
      String(
        data.producerName || ""
      ).trim(),

    published:
      data.published === true,

    createdAt:
      Date.now(),

    updatedAt:
      Date.now()

  };


  const created =
    await createFirestoreDocument(
      "soundkits",
      payload,
      token
    );


  return json(
    {
      success: true,
      ok: true,
      id:
        created.id
    },
    200,
    corsHeaders
  );
}


// ========================================================
// UPDATE SOUND KIT
// ========================================================

async function handleUpdateKit(
  request,
  corsHeaders
) {

  const user =
    await getAuthenticatedUser(
      request
    );


  if (!user) {

    return json(
      {
        success: false,
      error:
          "Authentication required"
      },
      401,
      corsHeaders
    );

  }


  const uid =
    user.sub;


  const token =
    request.headers
      .get("Authorization")
      .slice(7);


  let data;

  try {

    data =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error:
          "Invalid JSON body"
      },
      400,
      corsHeaders
    );

  }


  const kitId =
    String(
      data.kitId || ""
    ).trim();


  if (!kitId) {

    return json(
      {
        success: false,
        error:
          "kitId required"
      },
      400,
      corsHeaders
    );

  }


  const kit =
    await getFirestoreDocument(
      "soundkits",
      kitId,
      token
    );


  if (!kit.exists) {

    return json(
      {
        success: false,
        error:
          "Sound kit not found"
      },
      404,
      corsHeaders
    );

  }


  if (
    kit.data?.producerId !== uid
  ) {

    return json(
      {
        success: false,
        error:
          "Not your sound kit"
      },
      403,
      corsHeaders
    );

  }


  delete data.kitId;
  delete data.producerId;
  delete data.createdAt;


  data.updatedAt =
    Date.now();


  await updateFirestoreDocument(
    "soundkits",
    kitId,
    data,
    token
  );


  return json(
    {
      success: true,
      ok: true
    },
    200,
    corsHeaders
  );
}

// ========================================================
// SECURE DOWNLOAD
// ========================================================

async function handleSecureDownload(
  request,
  env,
  corsHeaders
) {

  // ------------------------------------------------------
  // AUTHENTICATION
  // ------------------------------------------------------

  const auth =
    await getAuthenticatedUser(
      request
    );

  if (!auth) {

    return json(
      {
        success: false,
        error:
          "Authentication required"
      },
      401,
      corsHeaders
    );

  }


  const buyerId =
    String(auth.sub || "").trim();


  if (!buyerId) {

    return json(
      {
        success: false,
        error:
          "Authenticated user ID missing"
      },
      401,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // TOKEN
  // ------------------------------------------------------

  const authHeader =
    request.headers.get(
      "Authorization"
    ) || "";

  const token =
    authHeader
      .replace(/^Bearer\s+/i, "")
      .trim();


  if (!token) {

    return json(
      {
        success: false,
        error:
          "Authorization token missing"
      },
      401,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // INPUT
  // ------------------------------------------------------

  let body;

  try {

    body =
      await request.json();

  } catch {

    return json(
      {
        success: false,
        error:
          "Invalid JSON body"
      },
      400,
      corsHeaders
    );

  }


  const beatId =
    String(
      body?.beatId || ""
    ).trim();


  const unlockId =
    String(
      body?.unlockId || ""
    ).trim();


  if (!beatId && !unlockId) {

    return json(
      {
        success: false,
        error:
          "beatId or unlockId is required"
      },
      400,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // FIND UNLOCK
  // ------------------------------------------------------

  let unlock = null;


  if (unlockId) {

    const snap =
      await getFirestoreDocument(
        "unlocks",
        unlockId,
        token
      );


    if (snap.exists) {

      unlock = {
        id: unlockId,
        data: snap.data || {}
      };

    }

  }


  // ------------------------------------------------------
  // FALLBACK: SEARCH BY BUYER + BEAT
  // ------------------------------------------------------

  if (!unlock && beatId) {

    const matches =
      await queryFirestore(
        "unlocks",
        "beatId",
        "EQUAL",
        beatId,
        token,
        25
      );


    const owned =
      matches.find(
        item =>
          String(
            item.data?.buyerId || ""
          ) === buyerId
      );


    if (owned) {

      unlock = {
        id: owned.id,
        data: owned.data || {}
      };

    }

  }


  // ------------------------------------------------------
  // NO UNLOCK
  // ------------------------------------------------------

  if (!unlock) {

    return json(
      {
        success: false,
        error:
          "Beat not unlocked for this user"
      },
      403,
      corsHeaders
    );

  }


  const unlockData =
    unlock.data || {};


  // ------------------------------------------------------
  // OWNERSHIP CHECK
  // ------------------------------------------------------

  if (
    String(
      unlockData.buyerId || ""
    ) !== buyerId
  ) {

    return json(
      {
        success: false,
        error:
          "Not your unlock"
      },
      403,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // PAYMENT CHECK
  // ------------------------------------------------------

  if (
    unlockData.paid === false
  ) {

    return json(
      {
        success: false,
        error:
          "Unlock has not been paid"
      },
      403,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // STATUS CHECK
  // ------------------------------------------------------

  const status =
    String(
      unlockData.status || ""
    ).toLowerCase();


  if (
    status &&
    status !== "unlocked"
  ) {

    return json(
      {
        success: false,
        error:
          "Unlock is not active"
      },
      403,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // DETERMINE BEAT ID
  // ------------------------------------------------------

  const finalBeatId =
    String(
      unlockData.beatId ||
      beatId ||
      ""
    ).trim();


  if (!finalBeatId) {

    return json(
      {
        success: false,
        error:
          "Beat ID missing from unlock"
      },
      400,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // GET BEAT
  // ------------------------------------------------------

  const beat =
    await getFirestoreDocument(
      "beats",
      finalBeatId,
      token
    );


  if (!beat.exists) {

    return json(
      {
        success: false,
        error:
          "Beat not found"
      },
      404,
      corsHeaders
    );

  }


  const beatData =
    beat.data || {};


  // ------------------------------------------------------
  // CURRENT R2 FILE
  // ------------------------------------------------------
  //
  // IMPORTANT:
  // Old unlocks may contain downloadPath values pointing
  // to files that disappeared from Firebase Storage.
  //
  // The current beat document is now the source of truth.
  // This allows old legitimate purchases to receive the
  // replacement audio file after a producer updates a beat.
  //

  const filePath =
    String(
      beatData.filePath ||
      beatData.downloadPath ||
      unlockData.downloadPath ||
      ""
    ).trim();


  if (!filePath) {

    return json(
      {
        success: false,
        error:
          "Download file path missing"
      },
      500,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // GET FILE FROM R2
  // ------------------------------------------------------

  const object =
    await env.AUDIO_R2.get(
      filePath
    );


  if (!object) {

    return json(
      {
        success: false,
        error:
          "Download file not found"
      },
      404,
      corsHeaders
    );

  }


  // ------------------------------------------------------
  // RESPONSE HEADERS
  // ------------------------------------------------------

  const headers =
    new Headers(
      corsHeaders
    );


  object.writeHttpMetadata(
    headers
  );


  headers.set(
    "etag",
    object.httpEtag
  );


  headers.set(
    "Cache-Control",
    "private, no-store"
  );


  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeFilename(
      beatData.title || "beat"
    )}.wav"`
  );


  // ------------------------------------------------------
  // DOWNLOAD LOG
  // ------------------------------------------------------

  try {

    await createFirestoreDocument(
      "downloadLogs",
      {
        type:
          "beat",

        buyerId,

        beatId:
          finalBeatId,

        beatTitle:
          String(
            beatData.title || ""
          ),

        unlockId:
          unlock.id,

        orderId:
          unlockData.orderId ||
          null,

        licenseKey:
          unlockData.licenseKey ||
          null,

        downloadedAt:
          Date.now(),

        userAgent:
          request.headers.get(
            "User-Agent"
          ) || ""

      },
      token
    );

  } catch (logError) {

    // Download must not fail just
    // because analytics logging fails.

    console.error(
      "Download logging failed:",
      logError
    );

  }


  // ------------------------------------------------------
  // RETURN FILE
  // ------------------------------------------------------

  return new Response(
    object.body,
    {
      status: 200,
      headers
    }
  );

}

function safeFilename(name) {

  return String(
    name || "download"
  )
    .replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(0, 150) ||
    "download";

}

// ========================================================
// HANDLE SECURE SOUND-KIT DOWNLOAD
// ========================================================

async function handleSecureKitDownload(
  request,
  env,
  corsHeaders
) {

  // ------------------------------------------------------
  // AUTH
  // ------------------------------------------------------

  const auth =
    await getAuthenticatedUser(request);

  if (!auth) {
    return json(
      {
        success: false,
        error: "Authentication required"
      },
      401,
      corsHeaders
    );
  }

  const buyerId =
    String(auth.sub || "").trim();

  if (!buyerId) {
    return json(
      {
        success: false,
        error: "Authenticated user ID missing"
      },
      401,
      corsHeaders
    );
  }

  const authHeader =
    request.headers.get("Authorization") || "";

  const token =
    authHeader
      .replace(/^Bearer\s+/i, "")
      .trim();

  if (!token) {
    return json(
      {
        success: false,
        error: "Authorization token missing"
      },
      401,
      corsHeaders
    );
  }


  // ------------------------------------------------------
  // INPUT
  // ------------------------------------------------------

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "Invalid JSON body"
      },
      400,
      corsHeaders
    );
  }

  const kitId =
    String(body?.kitId || "").trim();

  const unlockId =
    String(body?.unlockId || "").trim();

  if (!kitId && !unlockId) {
    return json(
      {
        success: false,
        error:
          "kitId or unlockId is required"
      },
      400,
      corsHeaders
    );
  }


  // ------------------------------------------------------
  // FIND UNLOCK
  // ------------------------------------------------------

  let unlock = null;

  if (unlockId) {

    const snap =
      await getFirestoreDocument(
        "unlocks",
        unlockId,
        token
      );

    if (snap.exists) {
      unlock = {
        id: unlockId,
        data: snap.data || {}
      };
    }
  }


  // ------------------------------------------------------
  // FALLBACK BY KIT ID
  // ------------------------------------------------------

  if (!unlock && kitId) {

    const matches =
      await queryFirestore(
        "unlocks",
        "kitId",
        "EQUAL",
        kitId,
        token,
        25
      );

    const owned =
      matches.find(
        item =>
          String(
            item.data?.buyerId || ""
          ) === buyerId &&
          String(
            item.data?.type || ""
          ).toLowerCase() === "soundkit"
      );

    if (owned) {
      unlock = {
        id: owned.id,
        data: owned.data || {}
      };
    }
  }


  // ------------------------------------------------------
  // AUTHORIZE
  // ------------------------------------------------------

  if (!unlock) {
    return json(
      {
        success: false,
        error:
          "Sound kit not unlocked for this user"
      },
      403,
      corsHeaders
    );
  }

  const unlockData =
    unlock.data || {};


  if (
    String(
      unlockData.buyerId || ""
    ) !== buyerId
  ) {
    return json(
      {
        success: false,
        error: "Not your unlock"
      },
      403,
      corsHeaders
    );
  }


  if (
    String(
      unlockData.type || ""
    ).toLowerCase() !== "soundkit"
  ) {
    return json(
      {
        success: false,
        error:
          "Unlock is not a sound-kit purchase"
      },
      403,
      corsHeaders
    );
  }


  if (unlockData.paid === false) {
    return json(
      {
        success: false,
        error: "Unlock has not been paid"
      },
      403,
      corsHeaders
    );
  }


  const status =
    String(
      unlockData.status || ""
    ).toLowerCase();

  if (
    status &&
    status !== "unlocked"
  ) {
    return json(
      {
        success: false,
        error: "Unlock is not active"
      },
      403,
      corsHeaders
    );
  }


  const finalKitId =
    String(
      unlockData.kitId ||
      kitId ||
      ""
    ).trim();

  if (!finalKitId) {
    return json(
      {
        success: false,
        error: "Sound-kit ID missing"
      },
      400,
      corsHeaders
    );
  }


  // ------------------------------------------------------
  // GET CURRENT SOUND KIT
  // ------------------------------------------------------

  const kit =
    await getFirestoreDocument(
      "soundkits",
      finalKitId,
      token
    );

  if (!kit.exists) {
    return json(
      {
        success: false,
        error: "Sound kit not found"
      },
      404,
      corsHeaders
    );
  }

  const kitData =
    kit.data || {};


  // ------------------------------------------------------
  // CURRENT SOUND-KIT R2 FILE
  // ------------------------------------------------------

  let filePath =
    String(
      kitData.filePath ||
      ""
    ).trim();

  if (
    !filePath &&
    kitData.downloadUrl
  ) {

    try {

      const downloadUrl =
        new URL(
          String(
            kitData.downloadUrl
          )
        );

      if (
        downloadUrl.pathname.startsWith(
          "/file/"
        )
      ) {

        filePath =
          decodeURIComponent(
            downloadUrl.pathname.substring(
              "/file/".length
            )
          );
      }

    } catch (e) {

      console.error(
        "Invalid sound-kit downloadUrl:",
        e
      );
    }
  }


  if (!filePath) {
    return json(
      {
        success: false,
        error:
          "Sound-kit file path missing"
      },
      500,
      corsHeaders
    );
  }


  // ------------------------------------------------------
  // GET FROM R2
  // ------------------------------------------------------

  const object =
    await env.AUDIO_R2.get(
      filePath
    );

  if (!object) {
    return json(
      {
        success: false,
        error:
          "Sound-kit file not found"
      },
      404,
      corsHeaders
    );
  }


  // ------------------------------------------------------
  // RESPONSE
  // ------------------------------------------------------

  const headers =
    new Headers(corsHeaders);

  object.writeHttpMetadata(
    headers
  );

  headers.set(
    "etag",
    object.httpEtag
  );

  headers.set(
    "Cache-Control",
    "private, no-store"
  );

  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeFilename(
      kitData.title ||
      kitData.name ||
      "Audiory Sound Kit"
    )}.zip"`
  );


  // ------------------------------------------------------
  // RETURN ZIP RESPONSE
  // ------------------------------------------------------

  return new Response(
    object.body,
    {
      status: 200,
      headers
    }
  );
}

// ========================================================
// AUDIORY LICENSE TERMS
// ========================================================

function termsFor(licenseKey) {
  if (licenseKey === "exclusive") {
    return [
      "Exclusive license: buyer receives exclusive rights to use the beat.",
      "Producer retains authorship credit unless transferred by written agreement.",
      "No resale/redistribution of the beat file itself.",
      "Must credit producer where applicable."
    ];
  }

  if (licenseKey === "premium") {
    return [
      "Premium license: buyer may use the beat commercially.",
      "Non-exclusive: producer may license the beat to others.",
      "No resale/redistribution of the beat file itself.",
      "Must credit producer where applicable."
    ];
  }

  return [
    "Basic license: buyer may use the beat under basic usage rights.",
    "Non-exclusive: producer may license the beat to others.",
    "No resale/redistribution of the beat file itself.",
    "Must credit producer where applicable."
  ];
}

// ========================================================
// GENERATE AUDIORY LICENSE PDF
// Cloudflare Worker version
// Returns Uint8Array PDF bytes
// ========================================================

async function generateAudioryLicensePDF({
  beatTitle,
  producerName,
  buyerName,
  buyerEmail,
  orderId,
  unlockId,
  licenseKey
}) {
  /*
    Minimal valid PDF generator.

    This intentionally does not use Node.js Buffer,
    Firebase Storage, or require("pdf-lib").

    It returns Uint8Array bytes that can be stored
    directly in Cloudflare R2.
  */

  const safe = (value) =>
    String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");

  const terms = termsFor(licenseKey);

  const lines = [
    "AUDIORY LICENSE AGREEMENT",
    "",
    `License Type: ${licenseKey.toUpperCase()}`,
    `Beat: ${beatTitle || "Beat"}`,
    `Producer: ${producerName || "Producer"}`,
    `Buyer Name: ${buyerName || "N/A"}`,
    `Buyer Email: ${buyerEmail || "N/A"}`,
    `Order ID: ${orderId || "N/A"}`,
    `Unlock ID: ${unlockId || "N/A"}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Terms of Use:",
    ...terms.map((term) => `- ${term}`),
    "",
    "This license is issued electronically via Audiory.",
    "Keep this document as proof of purchase and license rights."
  ];

  const streamLines = [];

  let y = 800;

  for (const line of lines) {
    const escaped = safe(line);

    streamLines.push(
      `BT /F1 11 Tf 50 ${y} Td (${escaped}) Tj ET`
    );

    y -= 18;

    if (y < 50) break;
  }

  const content = streamLines.join("\n");

  const objects = [];

  objects.push(
    `1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj`
  );

  objects.push(
    `2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj`
  );

  objects.push(
    `3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 595 842]
/Resources <<
/Font <<
/F1 4 0 R
>>
>>
/Contents 5 0 R
>>
endobj`
  );

  objects.push(
    `4 0 obj
<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
endobj`
  );

  objects.push(
    `5 0 obj
<<
/Length ${content.length}
>>
stream
${content}
endstream
endobj`
  );

  let pdf = "%PDF-1.4\n";

  const offsets = [0];

  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object + "\n";
  }

  const xrefOffset = pdf.length;

  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;

  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n 
`;
  }

  pdf += `trailer
<<
/Size ${objects.length + 1}
/Root 1 0 R
>>
startxref
${xrefOffset}
%%EOF`;

  return new TextEncoder().encode(pdf);
}

// ========================================================
// HANDLE LICENSE DOWNLOAD
// POST /api/licenseDownload
// ========================================================

async function handleLicenseDownload(
  request,
  env,
  corsHeaders
) {
  // ------------------------------------------------------
  // AUTHENTICATION
  // ------------------------------------------------------

  const authHeader =
    request.headers.get("Authorization") || "";

  const tokenMatch =
    authHeader.match(/^Bearer\s+(.+)$/i);

  if (!tokenMatch) {
    return json(
      {
        success: false,
        error: "Authorization token missing"
      },
      401,
      corsHeaders
    );
  }

  const token =
    tokenMatch[1].trim();

  const auth =
    await getAuthenticatedUser(request);

  if (!auth) {
    return json(
      {
        success: false,
        error: "Authentication required"
      },
      401,
      corsHeaders
    );
  }

  const buyerId =
    String(
      auth.sub ||
      auth.uid ||
      ""
    ).trim();

  if (!buyerId) {
    return json(
      {
        success: false,
        error: "Authentication uid missing"
      },
      401,
      corsHeaders
    );
  }

  // ------------------------------------------------------
  // INPUT
  // ------------------------------------------------------

  let body = {};

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "Invalid JSON body"
      },
      400,
      corsHeaders
    );
  }

  const beatId =
    String(body?.beatId || "").trim();

  const unlockId =
    String(body?.unlockId || "").trim();

  const orderId =
    String(body?.orderId || "").trim();

  const licenseKey =
    String(
      body?.licenseKey || "basic"
    )
      .trim()
      .toLowerCase();

  const allowedLicenses = [
    "basic",
    "premium",
    "exclusive"
  ];

  if (!allowedLicenses.includes(licenseKey)) {
    return json(
      {
        success: false,
        error: "Invalid licenseKey"
      },
      400,
      corsHeaders
    );
  }

  // ------------------------------------------------------
  // FIND UNLOCK
  // ------------------------------------------------------

  let unlockData = null;
  let actualUnlockId = "";

  if (unlockId) {
    const unlock =
      await getFirestoreDocument(
        "unlocks",
        unlockId,
        token
      );

    if (unlock?.exists) {
      const data =
        unlock.data || {};

      if (
        String(data.buyerId || "") !==
        buyerId
      ) {
        return json(
          {
            success: false,
            error: "Not your unlock"
          },
          403,
          corsHeaders
        );
      }

      unlockData = data;
      actualUnlockId = unlockId;
    }
  }

  // ------------------------------------------------------
  // FALLBACK: BEAT + BUYER
  // ------------------------------------------------------

  if (!unlockData) {
    if (!beatId) {
      return json(
        {
          success: false,
          error:
            "beatId is required if unlockId is not provided"
        },
        400,
        corsHeaders
      );
    }

    const results =
      await queryFirestore(
        "unlocks",
        [
          ["beatId", "EQUAL", beatId],
          ["buyerId", "EQUAL", buyerId]
        ],
        token
      );

    if (!results || !results.length) {
      return json(
        {
          success: false,
          error:
            "Beat not unlocked for this user"
        },
        403,
        corsHeaders
      );
    }

    let chosen = null;

    for (const item of results) {
      const data =
        item.data || {};

      if (
        String(
          data.licenseKey || ""
        )
          .toLowerCase() ===
        licenseKey
      ) {
        chosen = item;
        break;
      }
    }

    if (!chosen) {
      chosen = results[0];
    }

    unlockData =
      chosen.data || {};

    actualUnlockId =
      chosen.id;
  }

  // ------------------------------------------------------
  // PAYMENT CHECK
  // ------------------------------------------------------

  if (unlockData.paid === false) {
    return json(
      {
        success: false,
        error: "Unlock not paid"
      },
      403,
      corsHeaders
    );
  }

  const unlockStatus =
    String(
      unlockData.status || ""
    )
      .trim()
      .toLowerCase();

  if (
    unlockStatus &&
    unlockStatus !== "unlocked"
  ) {
    return json(
      {
        success: false,
        error: "Unlock is not active"
      },
      403,
      corsHeaders
    );
  }

  // ------------------------------------------------------
  // LICENSE OWNERSHIP
  // ------------------------------------------------------

  const purchasedLicense =
    String(
      unlockData.licenseKey ||
      "basic"
    )
      .trim()
      .toLowerCase();

  if (
    purchasedLicense !==
    licenseKey
  ) {
    return json(
      {
        success: false,
        error:
          "License does not belong to this purchase"
      },
      403,
      corsHeaders
    );
  }

  // ------------------------------------------------------
  // BEAT
  // ------------------------------------------------------

  const finalBeatId =
    String(
      unlockData.beatId ||
      beatId ||
      ""
    ).trim();

  if (!finalBeatId) {
    return json(
      {
        success: false,
        error: "beatId missing"
      },
      400,
      corsHeaders
    );
  }

  let beat;

  try {
    beat = await getFirestoreDocument(
      "beats",
      finalBeatId,
      token
    );
  } catch (error) {
    console.error(
      "LICENSE FIRESTORE ERROR - BEAT:",
      error
    );

    return json(
      {
        success: false,
        error: "Firestore permission error while reading beat",
        detail: error?.message || String(error)
      },
      500,
      corsHeaders
    );
  }

  if (!beat?.exists) {
    return json(
      {
        success: false,
        error: "Beat not found"
      },
      404,
      corsHeaders
    );
  }

  const beatData =
    beat.data || {};

  // ------------------------------------------------------
  // BUYER PROFILE
  // ------------------------------------------------------

  let userProfile = {};

  try {
    const user =
      await getFirestoreDocument(
        "users",
        buyerId,
        token
      );

    if (user?.exists) {
      userProfile = user.data || {};
    }
  } catch (error) {
    console.error(
      "LICENSE FIRESTORE ERROR - USER:",
      error
    );

    return json(
      {
        success: false,
        error: "Firestore permission error while reading user",
        detail: error?.message || String(error)
      },
      500,
      corsHeaders
    );
  }

  // ------------------------------------------------------
  // RESOLVE LICENSE INFORMATION
  // ------------------------------------------------------

  const buyerName =
    String(
      unlockData.buyerName ||
      userProfile.displayName ||
      userProfile.name ||
      auth.name ||
      ""
    );

  const buyerEmail =
    String(
      unlockData.buyerEmail ||
      userProfile.email ||
      auth.email ||
      ""
    );

  const beatTitle =
    String(
      unlockData.beatTitle ||
      beatData.title ||
      "Beat"
    );

  const producerName =
    String(
      unlockData.producerName ||
      beatData.producerName ||
      "Producer"
    );

  const finalOrderId =
    String(
      unlockData.orderId ||
      orderId ||
      "N/A"
    );

  // ------------------------------------------------------
  // CHECK EXISTING GENERATED LICENSE
  // ------------------------------------------------------

  let licensePath = "";

  if (
    unlockData.licenseGeneratedPath &&
    typeof unlockData.licenseGeneratedPath ===
      "object"
  ) {
    licensePath =
      String(
        unlockData
          .licenseGeneratedPath[
            licenseKey
          ] || ""
      ).trim();
  } else {
    licensePath =
      String(
        unlockData.licenseGeneratedPath ||
        ""
      ).trim();
  }

  // ------------------------------------------------------
  // IF PDF ALREADY EXISTS IN R2
  // ------------------------------------------------------

  if (licensePath) {
    const existing =
      await env.AUDIO_R2.get(
        licensePath
      );

    if (existing) {
      const headers =
        new Headers(corsHeaders);

      headers.set(
        "Content-Type",
        "application/pdf"
      );

      headers.set(
        "Content-Disposition",
        `attachment; filename="Audiory-${safeFilename(
          beatTitle
        )}-${licenseKey}-license.pdf"`
      );

      headers.set(
        "Cache-Control",
        "private, no-store"
      );

      return new Response(
        existing.body,
        {
          status: 200,
          headers
        }
      );
    }
  }

  // ------------------------------------------------------
  // GENERATE NEW PDF
  // ------------------------------------------------------

  const pdfBytes =
    await generateAudioryLicensePDF({
      beatTitle,
      producerName,
      buyerName,
      buyerEmail,
      orderId: finalOrderId,
      unlockId: actualUnlockId,
      licenseKey
    });

  if (
    !pdfBytes ||
    !(pdfBytes instanceof Uint8Array)
  ) {
    throw new Error(
      "License PDF generation failed"
    );
  }

  // ------------------------------------------------------
  // SAVE PDF TO R2
  // ------------------------------------------------------

  licensePath =
    `licenses/generated/${actualUnlockId}_${licenseKey}.pdf`;

  await env.AUDIO_R2.put(
    licensePath,
    pdfBytes,
    {
      httpMetadata: {
        contentType:
          "application/pdf",

        cacheControl:
          "private, no-store"
      }
    }
  );

  // ------------------------------------------------------
  // SAVE PATH TO FIRESTORE
  // USE YOUR EXISTING HELPER
  // ------------------------------------------------------

  await updateFirestoreDocument(
    "unlocks",
    actualUnlockId,
    {
      licenseGeneratedPath: {
        [licenseKey]:
          licensePath
      }
    },
    token
  );

  // ------------------------------------------------------
  // RETURN PDF
  // ------------------------------------------------------

  const headers =
    new Headers(corsHeaders);

  headers.set(
    "Content-Type",
    "application/pdf"
  );

  headers.set(
    "Content-Disposition",
    `attachment; filename="Audiory-${safeFilename(
      beatTitle
    )}-${licenseKey}-license.pdf"`
  );

  headers.set(
    "Cache-Control",
    "private, no-store"
  );

  return new Response(
    pdfBytes,
    {
      status: 200,
      headers
    }
  );
}
