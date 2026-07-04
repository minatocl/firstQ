/**
 * 電話番号・生年月日の正規化とハッシュ化。
 * 仕様: 電話番号・生年月日は KV に平文保存しない(SHA-256 ハッシュで照合)。
 * ここでは院内 pepper(TOKEN_SECRET)を鍵にした HMAC-SHA256 を用い、
 * レインボー攻撃に強くしつつ発行時・照合時で決定的に一致させる。
 */

const enc = new TextEncoder();

/** 全角数字→半角、非数字除去、+81/81 の国番号を 0 始まりに正規化 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  // 全角数字→半角
  const half = raw.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
  let digits = half.replace(/\D/g, "");
  // 国番号 +81 / 81 → 0(例: 819012345678 → 09012345678)
  if (digits.startsWith("81") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

/** 生年月日を YYYY-MM-DD に正規化(問診票は ISO 保存、照合ページも同形式で送る) */
export function normalizeDob(raw: string): string {
  if (!raw) return "";
  const m = raw.trim().match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})$/);
  if (!m) return "";
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 正規化済み電話番号のハッシュ(KV 索引キーにも使う) */
export function phoneHash(secret: string, rawPhone: string): Promise<string> {
  return hmacSha256Hex(secret, "phone:" + normalizePhone(rawPhone));
}

/** 正規化済み生年月日のハッシュ */
export function dobHash(secret: string, rawDob: string): Promise<string> {
  return hmacSha256Hex(secret, "dob:" + normalizeDob(rawDob));
}
