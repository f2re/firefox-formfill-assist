import { createHmac, randomUUID } from "node:crypto";

const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;

if (!issuer || !secret) {
  throw new Error("WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required");
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = encode({ alg: "HS256", typ: "JWT" });
const payload = encode({
  iss: issuer,
  jti: randomUUID(),
  iat: now,
  exp: now + 120,
});
const unsigned = `${header}.${payload}`;
const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");

process.stdout.write(`${unsigned}.${signature}`);
