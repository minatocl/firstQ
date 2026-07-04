/**
 * POST /api/card/issue  (スタッフ / X-Passcode 認証)
 * admin.html がカルテ番号を入力し発行ボタンを押すと呼ばれる。
 * 氏名・電話・生年月日・言語は admin が問診データから引き継いで送る
 * (この Worker は問診 KV に依存しない)。
 * 既存カルテ番号 / 受付コードでの再呼び出しは「再発行」として上書きする。
 */
import { checkPasscode } from "./auth";
import type { Env } from "./config";
import { dobHash, phoneHash } from "./hash";
import { json } from "./http";
import {
  getCard,
  getChartNoByCode,
  putCard,
  retireCard,
  ttlHours,
  type CardRecord,
} from "./kv";

interface IssueBody {
  code?: string; // 受付コード(問診票)
  chartNo?: string; // スタッフ入力のカルテ番号
  name?: string; // 券面氏名
  phone?: string;
  dob?: string;
  lang?: string;
}

export async function handleIssue(req: Request, env: Env): Promise<Response> {
  if (!checkPasscode(req, env)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 }, req, env);
  }

  let body: IssueBody;
  try {
    body = (await req.json()) as IssueBody;
  } catch {
    return json({ ok: false, error: "bad_json" }, { status: 400 }, req, env);
  }

  const chartNo = (body.chartNo || "").trim();
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const dob = (body.dob || "").trim();
  const code = (body.code || "").trim();
  const lang = (body.lang || "ja").trim();

  // カルテ番号は数字5桁ちょうど(枝番なし。スキャナがそのまま Dynamics に打鍵)
  if (!/^\d{5}$/.test(chartNo)) {
    return json({ ok: false, error: "invalid_chartNo" }, { status: 400 }, req, env);
  }
  if (!name) {
    return json({ ok: false, error: "missing_name" }, { status: 400 }, req, env);
  }
  if (!phone || !dob) {
    return json({ ok: false, error: "missing_phone_or_dob" }, { status: 400 }, req, env);
  }

  // 同一患者(受付コード)で番号を変えて再発行する場合、旧番号のレコードを失効させる。
  // 旧番号は以後どの照合にも一致しなくなる(患者は固定QRから新番号で再取得)。
  const prevChartNo = await getChartNoByCode(env, code);
  if (prevChartNo && prevChartNo !== chartNo) {
    const prev = await getCard(env, prevChartNo);
    if (prev) await retireCard(env, prev);
  }

  const now = Date.now();
  const rec: CardRecord = {
    chartNo,
    code,
    name,
    lang,
    phoneHash: await phoneHash(env.TOKEN_SECRET, phone),
    dobHash: await dobHash(env.TOKEN_SECRET, dob),
    issuedAt: now,
    expiresAt: now + ttlHours(env) * 3600_000,
    status: "issued",
  };
  await putCard(env, rec);

  return json(
    {
      ok: true,
      chartNo,
      status: "issued",
      issuedAt: rec.issuedAt,
      expiresAt: rec.expiresAt,
    },
    { status: 200 },
    req,
    env,
  );
}
