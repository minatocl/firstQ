/**
 * POST /api/card/verify  (公開 / 患者のスマホ)
 * 電話番号 + 生年月日で照合し、一致すれば短命ダウンロードトークンを返す。
 * 複数一致(双子・親子)のときは氏名候補を返し、二段階目で chartNo 指定を受ける。
 * 仕様: レート制限、両要素完全一致、対象は有効期限内の発行レコード。
 */
import type { Env } from "./config";
import { dobHash, phoneHash } from "./hash";
import { json } from "./http";
import { effectiveStatus, getCard, listChartNosByPhoneHash, type CardRecord } from "./kv";
import { checkAndIncrement } from "./rateLimit";
import { issueDownloadToken } from "./token";

interface VerifyBody {
  phone?: string;
  dob?: string;
  chartNo?: string; // 複数候補からの選択(二段階目)
}

function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

export async function handleVerify(req: Request, env: Env): Promise<Response> {
  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return json({ ok: false, reason: "bad_json" }, { status: 400 }, req, env);
  }

  const phone = (body.phone || "").trim();
  const dob = (body.dob || "").trim();
  const chosen = (body.chartNo || "").trim();

  if (!phone || !dob) {
    return json({ ok: false, reason: "missing" }, { status: 400 }, req, env);
  }

  const ph = await phoneHash(env.TOKEN_SECRET, phone);
  const dh = await dobHash(env.TOKEN_SECRET, dob);

  // レート制限(IP × 電話ハッシュ)
  const rl = await checkAndIncrement(env, clientIp(req), ph);
  if (!rl.allowed) {
    return json(
      { ok: false, reason: "ratelimited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      req,
      env,
    );
  }

  // 電話ハッシュ一致の候補を引き当て、生年月日ハッシュも一致するものを絞り込む
  const chartNos = await listChartNosByPhoneHash(env, ph);
  const now = Date.now();
  const dobMatches: CardRecord[] = [];
  for (const cn of chartNos) {
    const rec = await getCard(env, cn);
    if (rec && rec.dobHash === dh) dobMatches.push(rec);
  }

  const active = dobMatches.filter((r) => effectiveStatus(r, now) !== "expired");

  if (dobMatches.length === 0) {
    return json({ ok: false, reason: "nomatch" }, { status: 200 }, req, env);
  }
  if (active.length === 0) {
    // 一致はするが全て期限切れ → 再発行案内
    return json({ ok: false, reason: "expired" }, { status: 200 }, req, env);
  }

  // 二段階目: 候補選択後
  if (chosen) {
    const pick = active.find((r) => r.chartNo === chosen);
    if (!pick) {
      return json({ ok: false, reason: "nomatch" }, { status: 200 }, req, env);
    }
    const token = await issueDownloadToken(env, pick.chartNo);
    return json({ ok: true, token, name: pick.name }, { status: 200 }, req, env);
  }

  // 複数候補 → 氏名で選ばせる(両認証要素通過済みなので氏名表示は許容)
  if (active.length > 1) {
    return json(
      {
        ok: false,
        multiple: true,
        candidates: active.map((r) => ({ sel: r.chartNo, name: r.name })),
      },
      { status: 200 },
      req,
      env,
    );
  }

  // 単一一致 → トークン発行
  const token = await issueDownloadToken(env, active[0].chartNo);
  return json({ ok: true, token, name: active[0].name }, { status: 200 }, req, env);
}
