/**
 * minato-card Worker ルーター
 * みなとクリニック デジタル診察券(Apple Wallet)発行 API。
 *
 *   POST /api/card/issue        発行 / 再発行(スタッフ, X-Passcode)
 *   POST /api/card/verify       電話+生年月日で照合 → ダウンロードトークン(公開)
 *   GET  /api/card/pass/:token  署名済み .pkpass 返却(公開)
 *   POST /api/card/statuses     発行状態の一括取得(スタッフ, X-Passcode)
 *   GET  /api/card/health       稼働確認 / 署名モード表示
 */
import type { Env } from "./config";
import { googleConfigured } from "./google/wallet";
import { handleGooglePass } from "./googlePass";
import { preflight } from "./http";
import { handleIssue } from "./issue";
import { handlePass } from "./pass";
import { handleStatuses } from "./statuses";
import { handleVerify } from "./verify";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, ""); // 末尾スラッシュ除去

    if (req.method === "OPTIONS") return preflight(req, env);

    if (path === "/api/card/issue" && req.method === "POST") {
      return handleIssue(req, env);
    }
    if (path === "/api/card/verify" && req.method === "POST") {
      return handleVerify(req, env);
    }
    if (path === "/api/card/statuses" && req.method === "POST") {
      return handleStatuses(req, env);
    }
    const passMatch = path.match(/^\/api\/card\/pass\/([A-Za-z0-9._-]+)$/);
    if (passMatch && req.method === "GET") {
      return handlePass(req, env, passMatch[1]);
    }
    const googleMatch = path.match(/^\/api\/card\/google\/([A-Za-z0-9._-]+)$/);
    if (googleMatch && req.method === "GET") {
      return handleGooglePass(req, env, googleMatch[1]);
    }
    if (path === "/api/card/health" && req.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "minato-card",
          signing: env.DUMMY_SIGNING === "1" ? "dummy" : "production",
          google: googleConfigured(env) ? "configured" : "off",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
