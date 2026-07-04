/**
 * 照合レート制限: 同一IP・同一電話ハッシュあたり 試行 N回/時。
 * KV に原子的インクリメントは無いため {count, resetAt} を読み書きする軽量方式。
 * クリニック規模の同時実行では十分。
 */
import type { Env } from "./config";

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function checkAndIncrement(
  env: Env,
  ip: string,
  phoneHash: string,
): Promise<RateResult> {
  const limit = Math.max(1, parseInt(env.RATE_LIMIT_PER_HOUR || "5", 10));
  const windowMs = 3600_000;
  const key = `rl:${ip}:${phoneHash}`;
  const now = Date.now();

  let bucket = await env.CARD_KV.get<Bucket>(key, "json");
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  const ttlSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  await env.CARD_KV.put(key, JSON.stringify(bucket), { expirationTtl: ttlSec });

  return {
    allowed: true,
    remaining: limit - bucket.count,
    retryAfterSec: 0,
  };
}
