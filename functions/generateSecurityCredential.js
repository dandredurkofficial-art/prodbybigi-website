// generateSecurityCredential.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CERT_PATH = path.join(__dirname, "ProductionCertificate.pem");

// put your initiator password here (the one you set on org portal)
const INITIATOR_PASSWORD = "HalimaIsmael20!";

const certPem = fs.readFileSync(CERT_PATH, "utf8");

// IMPORTANT: for Daraja SecurityCredential use RSA PKCS#1 v1.5 (NOT OAEP)
const encrypted = crypto.publicEncrypt(
  {
    key: certPem,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  },
  Buffer.from(INITIATOR_PASSWORD, "utf8")
);

console.log("SecurityCredential (base64):");
console.log(encrypted.toString("base64"));
