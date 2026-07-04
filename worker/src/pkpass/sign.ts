/**
 * manifest.json への PKCS#7 detached 署名。
 * 証明書・秘密鍵は Worker Secrets(env)から読む。
 * ダミー自己署名(scripts/gen-dummy-certs.mjs 生成)でも本番 Apple 証明書でも
 * コード変更なしで動くように、両者を同じ経路で処理する。
 *
 * node-forge を使用(workerd + nodejs_compat で動作)。RSA PKCS#1 v1.5 署名は
 * 決定的なため RNG に依存しない。
 */
import forge from "node-forge";
import type { Env } from "../config";

function u8ToBinaryString(u8: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk) as unknown as number[]);
  }
  return s;
}
function binaryStringToU8(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function loadPrivateKey(env: Env): forge.pki.rsa.PrivateKey {
  const pass = env.PASS_KEY_PASSPHRASE || "";
  if (pass) {
    const key = forge.pki.decryptRsaPrivateKey(env.PASS_KEY_PEM, pass);
    if (!key) throw new Error("秘密鍵の復号に失敗(PASS_KEY_PASSPHRASE を確認)");
    return key;
  }
  return forge.pki.privateKeyFromPem(env.PASS_KEY_PEM);
}

/**
 * detached PKCS#7(DER)を返す。manifest.json のバイト列を入力にとる。
 */
export function signManifest(manifest: Uint8Array, env: Env): Uint8Array {
  const cert = forge.pki.certificateFromPem(env.PASS_CERT_PEM);
  const key = loadPrivateKey(env);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(u8ToBinaryString(manifest));
  p7.addCertificate(cert);

  // 中間証明書(本番: Apple WWDR / ダミー: 生成した CA)。あれば同梱してチェーンを作る。
  const wwdrPem = (env.WWDR_CERT_PEM || "").trim();
  if (wwdrPem) {
    try {
      p7.addCertificate(forge.pki.certificateFromPem(wwdrPem));
    } catch {
      // 中間証明書が不正でも署名自体は続行(ダミー時など)
    }
  }

  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest }, // 自動計算
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });

  // detached: 署名対象(manifest)は署名構造に含めない
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return binaryStringToU8(der);
}
