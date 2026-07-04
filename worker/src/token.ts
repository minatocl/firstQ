/**
 * ダウンロードトークン: HMAC-SHA256(カルテ番号 + exp + nonce)。
 * 仕様: 有効10分、1回使用で KV に消込。
 * - HMAC で改ざん検知
 * - KV の nonce レコードで「1回だけ使える」を担保(消込 = get して即 delete)
 */
import type { Env } from "./config";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sign(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** タイミング安全な等価比較 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const ttlMinutes = (env: Env) => Math.max(1, parseInt(env.TOKEN_TTL_MINUTES || "10", 10));

/** 発行: 照合成功時に呼ぶ。トークン文字列を返す。 */
export async function issueDownloadToken(env: Env, chartNo: string): Promise<string> {
  const exp = nowMs() + ttlMinutes(env) * 60_000;
  const nonce = crypto.randomUUID();
  const payload = `${chartNo}.${exp}.${nonce}`;
  const sig = await sign(env.TOKEN_SECRET, payload);
  const token = `${b64url(enc.encode(payload))}.${b64url(sig)}`;
  // 1回消込用の nonce レコード。TTL 経過で自動失効。
  await env.CARD_KV.put(`dltok:${nonce}`, chartNo, {
    expirationTtl: ttlMinutes(env) * 60,
  });
  return token;
}

export type TokenResult =
  | { ok: true; chartNo: string }
  | { ok: false; reason: "malformed" | "badsig" | "expired" | "used" };

/** 検証 + 消込。成功時 chartNo を返し、KV レコードを削除する。 */
export async function verifyAndConsumeToken(env: Env, token: string): Promise<TokenResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  let payload: string;
  try {
    payload = new TextDecoder().decode(b64urlDecode(parts[0]));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const seg = payload.split(".");
  if (seg.length !== 3) return { ok: false, reason: "malformed" };
  const [chartNo, expStr, nonce] = seg;

  const expected = await sign(env.TOKEN_SECRET, payload);
  let got: Uint8Array;
  try {
    got = b64urlDecode(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, got)) return { ok: false, reason: "badsig" };

  if (nowMs() > Number(expStr)) return { ok: false, reason: "expired" };

  // 1回消込: nonce レコードを取得し、無ければ使用済み。
  const rec = await env.CARD_KV.get(`dltok:${nonce}`);
  if (rec === null || rec !== chartNo) return { ok: false, reason: "used" };
  await env.CARD_KV.delete(`dltok:${nonce}`);
  return { ok: true, chartNo };
}

// Workers では Date.now() が使えるが、テスト容易性のため一箇所に集約。
function nowMs(): number {
  return Date.now();
}
