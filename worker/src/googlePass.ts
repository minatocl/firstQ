/**
 * GET /api/card/google/:token  (公開 / Android の Chrome 等から遷移)
 * トークンを検証・消込し、「Google Wallet に保存」URL へ 302 リダイレクトする。
 */
import type { Env } from "./config";
import { buildGoogleSaveUrl, googleConfigured } from "./google/wallet";
import { effectiveStatus, getCard, updateCard } from "./kv";
import { verifyDownloadToken } from "./token";

export async function handleGooglePass(
  _req: Request,
  env: Env,
  token: string,
): Promise<Response> {
  if (!googleConfigured(env)) {
    return new Response("google wallet not configured", { status: 503 });
  }

  const res = await verifyDownloadToken(env, token);
  if (!res.ok) {
    const status = res.reason === "expired" || res.reason === "used" ? 410 : 400;
    return new Response(`token ${res.reason}`, { status });
  }

  const rec = await getCard(env, res.chartNo);
  if (!rec) return new Response("not found", { status: 404 });
  if (effectiveStatus(rec, Date.now()) === "expired") {
    return new Response("card expired", { status: 410 });
  }

  let saveUrl: string;
  try {
    saveUrl = await buildGoogleSaveUrl(env, rec);
  } catch (e) {
    console.error("google save url build failed", e);
    return new Response("google pass generation failed", { status: 500 });
  }

  if (rec.status !== "added") {
    rec.status = "added";
    rec.addedAt = Date.now();
    await updateCard(env, rec);
  }

  return new Response(null, {
    status: 302,
    headers: { Location: saveUrl, "Cache-Control": "no-store" },
  });
}
