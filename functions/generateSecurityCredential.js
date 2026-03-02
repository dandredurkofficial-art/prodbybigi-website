const fs = require("fs");
const crypto = require("crypto");

// 🔴 PUT YOUR INITIATOR PASSWORD HERE
const initiatorPassword = "HalimaIsmael20!";

// Read the production certificate
const cert = fs.readFileSync("ProductionCertificate.cer");

// Convert to PEM format
const pem = `-----BEGIN CERTIFICATE-----\n${cert
  .toString("base64")
  .match(/.{1,64}/g)
  .join("\n")}\n-----END CERTIFICATE-----`;

// Extract public key
const publicKey = crypto.createPublicKey(pem);

// Encrypt using RSA PKCS1 v1.5
const encrypted = crypto.publicEncrypt(
  {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  },
  Buffer.from(initiatorPassword)
);

// Output base64 SecurityCredential
console.log("\n🔐 SecurityCredential:\n");
console.log(encrypted.toString("base64"));
