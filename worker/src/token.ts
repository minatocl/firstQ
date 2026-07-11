/**
 * ダウンロードトークン: HMAC-SHA256(カルテ番号 + exp + nonce)。
 * 仕様: 有効10分。HMAC署名＋有効期限で担保し、期限内は再利用可。
 *
 * ※ 以前は KV nonce で「1回きり(即消し)」にしていたが、iOS Safari が
 *   pkpass 取得時に同一URLを二重リクエストすることがあり、2回目が「used」
 *   エラーになる不具合が出た。自分の診察券を10分内に再取得できるだけで実害が
 *   ないため、one-time 消込を廃止して二重リクエスト/再タップに強くした。
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

/** 発行: 照合成功時に呼ぶ。署名付きトークン文字列を返す(KVは使わない)。 */
export async function issueDownloadToken(env: Env, chartNo: string): Promise<string> {
  const exp = nowMs() + ttlMinutes(env) * 60_000;
  const nonce = crypto.randomUUID(); // トークンを一意化(推測防止)
  const payload = `${chartNo}.${exp}.${nonce}`;
  const sig = await sign(env.TOKEN_SECRET, payload);
  return `${b64url(enc.encode(payload))}.${b64url(sig)}`;
}

export type TokenResult =
  | { ok: true; chartNo: string }
  | { ok: false; reason: "malformed" | "badsig" | "expired" | "used" };

/**
 * 検証: HMAC署名 + 有効期限(10分)を確認。成功時 chartNo を返す。
 * 期限内は何度でも使える(二重リクエスト・再タップ耐性)。
 */
export async function verifyDownloadToken(env: Env, token: string): Promise<TokenResult> {
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
  const chartNo = seg[0];
  const expStr = seg[1];

  const expected = await sign(env.TOKEN_SECRET, payload);
  let got: Uint8Array;
  try {
    got = b64urlDecode(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, got)) return { ok: false, reason: "badsig" };
  if (nowMs() > Number(expStr)) return { ok: false, reason: "expired" };

  return { ok: true, chartNo };
}

// Workers では Date.now() が使えるが、テスト容易性のため一箇所に集約。
function nowMs(): number {
  return Date.now();
}
