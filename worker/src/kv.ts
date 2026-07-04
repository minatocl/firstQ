/**
 * CARD_KV の発行レコードと索引の read/write ヘルパ。
 *
 * キー設計:
 *   card:{chartNo}       発行レコード(CardRecord JSON)
 *   codeidx:{code}       受付コード → カルテ番号(admin の状態表示 / 再発行判定用)
 *   phoneidx:{phoneHash} 電話ハッシュ → カルテ番号配列(照合の候補引き当て用)
 *   dltok:{nonce}        ダウンロードトークン消込(token.ts)
 *   rl:{...}             レート制限(rateLimit.ts)
 */
import type { CardStatus, Env } from "./config";

export interface CardRecord {
  chartNo: string; // カルテ番号(= serialNumber, QR message)
  code: string; // 由来の受付コード(問診票)
  name: string; // 券面 primaryFields に出す氏名
  lang: string; // 問診票で選択した言語(既定 lproj のヒント)
  phoneHash: string;
  dobHash: string;
  issuedAt: number; // epoch ms
  expiresAt: number; // epoch ms(発行 + TTL)
  status: CardStatus; // issued / added / expired(added のみ明示保存)
  addedAt?: number;
}

export function ttlHours(env: Env): number {
  return Math.max(1, parseInt(env.CARD_TTL_HOURS || "72", 10));
}

/** 保存された status と有効期限から実効ステータスを算出 */
export function effectiveStatus(rec: CardRecord, now: number): CardStatus {
  if (rec.status === "added") return "added";
  if (now > rec.expiresAt) return "expired";
  return "issued";
}

export async function getCard(env: Env, chartNo: string): Promise<CardRecord | null> {
  return env.CARD_KV.get<CardRecord>(`card:${chartNo}`, "json");
}

export async function getChartNoByCode(env: Env, code: string): Promise<string | null> {
  return env.CARD_KV.get(`codeidx:${code}`);
}

export async function listChartNosByPhoneHash(
  env: Env,
  phoneHash: string,
): Promise<string[]> {
  return (await env.CARD_KV.get<string[]>(`phoneidx:${phoneHash}`, "json")) ?? [];
}

async function addToPhoneIndex(env: Env, phoneHash: string, chartNo: string): Promise<void> {
  const list = await listChartNosByPhoneHash(env, phoneHash);
  if (!list.includes(chartNo)) {
    list.push(chartNo);
    await env.CARD_KV.put(`phoneidx:${phoneHash}`, JSON.stringify(list));
  }
}

async function removeFromPhoneIndex(
  env: Env,
  phoneHash: string,
  chartNo: string,
): Promise<void> {
  const list = await listChartNosByPhoneHash(env, phoneHash);
  const next = list.filter((c) => c !== chartNo);
  if (next.length !== list.length) {
    if (next.length) await env.CARD_KV.put(`phoneidx:${phoneHash}`, JSON.stringify(next));
    else await env.CARD_KV.delete(`phoneidx:${phoneHash}`);
  }
}

/** 発行 / 再発行。card 本体・codeidx・phoneidx をまとめて更新する。 */
export async function putCard(env: Env, rec: CardRecord): Promise<void> {
  await env.CARD_KV.put(`card:${rec.chartNo}`, JSON.stringify(rec));
  await env.CARD_KV.put(`codeidx:${rec.code}`, rec.chartNo);
  await addToPhoneIndex(env, rec.phoneHash, rec.chartNo);
}

/**
 * 旧カルテ番号のレコードを失効させる(番号変更を伴う再発行時)。
 * card 本体を削除し phoneidx から外す。以後、旧番号は照合に一致しない。
 */
export async function retireCard(env: Env, rec: CardRecord): Promise<void> {
  await env.CARD_KV.delete(`card:${rec.chartNo}`);
  await removeFromPhoneIndex(env, rec.phoneHash, rec.chartNo);
}

/** 状態のみ更新(例: Wallet 追加検知で added に)。索引は変えない。 */
export async function updateCard(env: Env, rec: CardRecord): Promise<void> {
  await env.CARD_KV.put(`card:${rec.chartNo}`, JSON.stringify(rec));
}
