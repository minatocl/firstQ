/**
 * Google 向け JWT の共通部品(base64url / PKCS#8 読み込み / RS256 署名)。
 * wallet.ts(保存用 JWT)と oauth.ts(アクセストークン取得)の両方から使う。
 */

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const b64urlStr = (s: string) => b64url(enc.encode(s));

/** PKCS#8 PEM(service account の private_key)→ DER。JSON の \n エスケープも吸収。 */
export function pkcs8Der(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signRS256(privatePem: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der(privatePem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return b64url(new Uint8Array(sig));
}

/** ヘッダ+クレームを RS256 署名して JWT 文字列にする */
export async function makeJwt(
  privatePem: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlStr(
    JSON.stringify(claims),
  )}`;
  return `${signingInput}.${await signRS256(privatePem, signingInput)}`;
}
