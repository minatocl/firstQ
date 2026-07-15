/**
 * サービスアカウント秘密鍵 → OAuth2 アクセストークン(wallet_object.issuer スコープ)。
 * 保存用 JWT と違い、既存パスオブジェクトの更新(REST PATCH)にはトークンが要る。
 *
 * 保存用 JWT は「オブジェクトが未作成なら作る」だけで、既に存在する場合は
 * ペイロードの中身が無視される(再発行しても Android は旧券面のまま)。
 * そのため発行・失効の時点で REST PATCH を打つ必要がある。
 */
import type { Env } from "../config";
import { makeJwt } from "./jwt";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

// isolate 内キャッシュ(有効期限の 60 秒前に取り直す)
let cached: { token: string; expMs: number } | null = null;

export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cached && cached.expMs > now + 60_000) return cached.token;

  const iat = Math.floor(now / 1000);
  const assertion = await makeJwt(env.GOOGLE_SA_PRIVATE_KEY!, {
    iss: env.GOOGLE_SA_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URI,
    iat,
    exp: iat + 3600,
  });

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`google token failed: ${res.status} ${body.error_description ?? ""}`);
  }

  cached = { token: body.access_token, expMs: now + 3600_000 };
  return body.access_token;
}
