import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const b64 = (value) => Buffer.from(value, "base64url");
const vapidPublicKey = Buffer.concat([Buffer.from([4]), b64(publicJwk.x), b64(publicJwk.y)]).toString("base64url");
const vapidPrivateKey = privateJwk.d;

function putSecret(name, value) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["wrangler", "secret", "put", name], {
    input: `${value}\n`,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${name} secret configuration failed: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

putSecret("VAPID_PUBLIC_KEY", vapidPublicKey);
putSecret("VAPID_PRIVATE_KEY", vapidPrivateKey);
console.log("VAPID secrets configured without printing key values.");
