/** 発行系 API の簡易認証: admin.html と共通の X-Passcode ヘッダ。 */
import type { Env } from "./config";

export function checkPasscode(req: Request, env: Env): boolean {
  const given = req.headers.get("X-Passcode") ?? "";
  const expected = env.ADMIN_PASSCODE ?? "";
  if (!expected) return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
