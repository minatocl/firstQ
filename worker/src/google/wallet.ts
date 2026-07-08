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

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (s: string) => b64url(enc.encode(s));

/** PKCS#8 PEM(service account の private_key)→ DER。JSON の \n エスケープも吸収。 */
function pkcs8Der(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signRS256(privatePem: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der(privatePem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return b64url(new Uint8Array(sig));
}

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

/** 発行レコードから「Google Wallet に保存」URL を生成 */
export async function buildGoogleSaveUrl(env: Env, rec: CardRecord): Promise<string> {
  const issuerId = env.GOOGLE_ISSUER_ID!;
  const classId = `${issuerId}.minato_card_generic`;
  const objectId = `${issuerId}.${rec.chartNo}`;
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

  const claims = {
    iss: env.GOOGLE_SA_EMAIL,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [{ id: classId }],
      genericObjects: [genericObject],
    },
  };

  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claims))}`;
  const sig = await signRS256(env.GOOGLE_SA_PRIVATE_KEY!, signingInput);
  const jwt = `${signingInput}.${sig}`;

  return `https://pay.google.com/gp/v/save/${jwt}`;
}
