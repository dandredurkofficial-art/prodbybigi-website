const fs = require("fs");
const crypto = require("crypto");

// 🔴 PUT YOUR INITIATOR PASSWORD HERE
const initiatorPassword = "HalimaIsmael20!";

// Read certificate file directly
const cert = fs.readFileSync("ProductionCertificate.cer");

// Create public key directly from certificate
const publicKey = crypto.createPublicKey({
  key: cert,
  format: "der",
  type: "spki",
});

// Encrypt using RSA PKCS1 v1.5
const encrypted = crypto.publicEncrypt(
  {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  },
  Buffer.from(initiatorPassword)
);

console.log("\n🔐 SecurityCredential:\n");
console.log(encrypted.toString("base64"));
