/**
 * Google Wallet(Android)対応。
 * ファイルではなく「Google Wallet に保存」用の署名付き JWT を生成し、
 *   https://pay.google.com/gp/v/save/{jwt}
 * へ遷移させて追加する方式。JWT は Google Cloud のサービスアカウント秘密鍵で RS256 署名。
 * WebCrypto のみで完結(外部ライブラリ不要)。
 *
 * 必要な Secret: GOOGLE_ISSUER_ID / GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY
 */
import { BACK_FIELDS, PASS_LANGS, PASS_STRINGS, type Env } from "../config";
import type { CardRecord } from "../kv";
import { makeJwt } from "./jwt";
import { getAccessToken } from "./oauth";

const WOBJ_API = "https://walletobjects.googleapis.com/walletobjects/v1";

/** Google の LocalizedString(defaultValue + translatedValues) */
function localized(byLang: Record<string, string>) {
  return {
    defaultValue: { language: "ja", value: byLang.ja },
    translatedValues: PASS_LANGS.filter((l) => l !== "ja").map((l) => ({
      language: l,
      value: byLang[l] ?? byLang.ja,
    })),
  };
}
/** ラベルキー(NAME_LABEL 等)を全言語ぶん LocalizedString 化 */
function label(key: "NAME_LABEL" | "ID_LABEL" | "ISSUED_LABEL") {
  const byLang: Record<string, string> = {};
  for (const l of PASS_LANGS) byLang[l] = PASS_STRINGS[l][key];
  return localized(byLang);
}

function fmtIssued(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function hexColor(): string {
  return "#262055"; // 紫紺(Apple と同色)
}

export function googleConfigured(env: Env): boolean {
  return !!(env.GOOGLE_ISSUER_ID && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY);
}

const classIdOf = (env: Env) => `${env.GOOGLE_ISSUER_ID}.minato_card_generic`;
const objectIdOf = (env: Env, chartNo: string) => `${env.GOOGLE_ISSUER_ID}.${chartNo}`;

/** 発行レコードから genericObject の JSON を組み立てる */
function buildGenericObject(env: Env, rec: CardRecord) {
  const classId = classIdOf(env);
  const objectId = objectIdOf(env, rec.chartNo);
  const logoUri =
    env.GOOGLE_LOGO_URI || "https://minatocl.github.io/firstQ/pass-logo/google-logo.png";

  // 裏面相当(日本語固定)を Details の textModules として付加
  const backModules = BACK_FIELDS.map((f) => ({
    id: f.key,
    header: f.label,
    body: f.value,
  }));

  const genericObject = {
    id: objectId,
    classId,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    state: "ACTIVE",
    hexBackgroundColor: hexColor(),
    logo: { sourceUri: { uri: logoUri } },
    cardTitle: localized({
      ja: env.ORG_NAME, en: env.ORG_NAME, "zh-Hans": env.ORG_NAME,
      pt: env.ORG_NAME, es: env.ORG_NAME, th: env.ORG_NAME,
    }),
    header: localized({
      ja: rec.name, en: rec.name, "zh-Hans": rec.name,
      pt: rec.name, es: rec.name, th: rec.name,
    }),
    barcode: {
      type: "QR_CODE",
      value: rec.chartNo, // カルテ番号のみ(受付スキャナがそのまま打鍵)
      alternateText: rec.chartNo,
    },
    textModulesData: [
      { id: "chartNo", localizedHeader: label("ID_LABEL"), body: rec.chartNo },
      {
        id: "issued",
        localizedHeader: label("ISSUED_LABEL"),
        body: fmtIssued(rec.issuedAt),
      },
      ...backModules,
    ],
  };

  return genericObject;
}

/**
 * 既存パスオブジェクトを最新の発行内容に更新する(存在しなければ何もしない)。
 * PATCH が通れば、患者が既に保存済みの Android 端末の券面も自動で更新される。
 * @returns true = 既存を更新した / false = 未作成だった
 */
export async function patchGoogleObjectIfExists(env: Env, rec: CardRecord): Promise<boolean> {
  const id = objectIdOf(env, rec.chartNo);
  const res = await fetch(`${WOBJ_API}/genericObject/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${await getAccessToken(env)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGenericObject(env, rec)),
  });
  if (res.status === 404) return false; // 未保存の患者。作成は保存 JWT 側に任せる
  if (!res.ok) throw new Error(`google patch failed: ${res.status} ${await res.text()}`);
  return true;
}

/**
 * パスオブジェクトを失効させる(カルテ番号変更・再発行で旧券を無効化する)。
 * KV を消すだけでは Android 端末に残った旧 QR が受付スキャナで通ってしまうため必須。
 */
export async function expireGoogleObject(env: Env, chartNo: string): Promise<void> {
  const id = objectIdOf(env, chartNo);
  const res = await fetch(`${WOBJ_API}/genericObject/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${await getAccessToken(env)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: "EXPIRED" }),
  });
  if (res.status === 404) return; // Google に保存されたことがない
  if (!res.ok) throw new Error(`google expire failed: ${res.status} ${await res.text()}`);
}

/** 発行レコードから「Google Wallet に保存」URL を生成 */
export async function buildGoogleSaveUrl(env: Env, rec: CardRecord): Promise<string> {
  // 保存 JWT は既存オブジェクトを更新しない(ペイロードが無視される)。
  // 再保存で旧券面が出ないよう、先に PATCH で中身を最新化しておく。
  // 未作成(404)の場合はここでは作らず、下の JWT に作らせる。
  await patchGoogleObjectIfExists(env, rec);

  const claims = {
    iss: env.GOOGLE_SA_EMAIL,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [{ id: classIdOf(env) }],
      genericObjects: [buildGenericObject(env, rec)],
    },
  };

  return `https://pay.google.com/gp/v/save/${await makeJwt(env.GOOGLE_SA_PRIVATE_KEY!, claims)}`;
}
