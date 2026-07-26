/**
 * POST /api/card/statuses  (スタッフ / X-Passcode 認証)
 * admin.html が受付コード配列を送り、各カードの発行状態を受け取る。
 * 返り値: { statuses: { [code]: { chartNo, status, issuedAt, expiresAt } } }
 */
import { checkPasscode } from "./auth";
import type { Env } from "./config";
import { json } from "./http";
import { effectiveStatus, getCard, getChartNoByCode } from "./kv";

export async function handleStatuses(req: Request, env: Env): Promise<Response> {
  if (!checkPasscode(req, env)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 }, req, env);
  }

  let codes: string[] = [];
  try {
    const body = (await req.json()) as { codes?: string[] };
    codes = Array.isArray(body.codes) ? body.codes.slice(0, 200) : [];
  } catch {
    return json({ ok: false, error: "bad_json" }, { status: 400 }, req, env);
  }

  const now = Date.now();
  const statuses: Record<
    string,
    { chartNo: string; status: string; issuedAt: number; expiresAt: number }
  > = {};

  // コードごとに直列で読むとKVの待ち時間×件数かかるため、全件並列で読む
  await Promise.all(
    codes.map(async (code) => {
      const chartNo = await getChartNoByCode(env, code);
      if (!chartNo) return;
      const rec = await getCard(env, chartNo);
      if (!rec) return;
      statuses[code] = {
        chartNo: rec.chartNo,
        status: effectiveStatus(rec, now),
        issuedAt: rec.issuedAt,
        expiresAt: rec.expiresAt,
      };
    }),
  );

  return json({ ok: true, statuses }, { status: 200 }, req, env);
}
