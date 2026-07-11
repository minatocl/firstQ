/**
 * GET /api/card/pass/:token  (公開 / Safari が直接遷移)
 * トークンを検証・消込し、署名済み .pkpass を返す。
 * ダウンロード成立を Wallet 追加のシグナルとして status を added にする(best-effort)。
 */
import type { Env } from "./config";
import { effectiveStatus, getCard, updateCard } from "./kv";
import { buildPkpass } from "./pkpass/build";
import { verifyDownloadToken } from "./token";

export async function handlePass(_req: Request, env: Env, token: string): Promise<Response> {
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

  let pkpass: Uint8Array;
  try {
    pkpass = buildPkpass(rec, env);
  } catch (e) {
    console.error("pkpass build failed", e);
    return new Response("pass generation failed", { status: 500 });
  }

  // 追加検知(best-effort): 未追加なら added に更新
  if (rec.status !== "added") {
    rec.status = "added";
    rec.addedAt = Date.now();
    await updateCard(env, rec);
  }

  return new Response(pkpass, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="minato-${rec.chartNo}.pkpass"`,
      "Cache-Control": "no-store",
    },
  });
}
