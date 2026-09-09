// Run once after Firebase access is available. Never print or commit the private key.
const fs = require("node:fs");
const path = require("node:path");
const { generateVAPIDKeys } = require("web-push");
const contact = process.argv[2];
if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact || "")) {
  throw new Error("Usage: node functions/setup-keys.js mailto:owner@example.com");
}
const config = path.join(__dirname, ".env.daily-grind-370cd");
const secret = path.join(__dirname, ".secret.calendar-push-private-key");
if (fs.existsSync(config) || fs.existsSync(secret)) throw new Error("Key files already exist. Reuse the existing keys; do not rotate active subscriptions accidentally.");
const keys = generateVAPIDKeys();
fs.writeFileSync(secret, keys.privateKey, { flag: "wx", mode: 0o600 });
fs.writeFileSync(config, `CALENDAR_PUSH_PUBLIC_KEY=${keys.publicKey}\nCALENDAR_PUSH_CONTACT=${contact}\n`, { flag: "wx" });
console.log("Created ignored public configuration and private key files. Import the private key into Firebase Secret Manager using --data-file; never paste it into chat.");
