/**
 * 環境バインディング型と、pass.json 生成に使う固定値(配色・裏面・多言語ラベル)。
 * 仕様書: docs/digital-card-spec.md
 */

export interface Env {
  // KV: 発行レコード / ダウンロードトークン / レート制限 / 索引
  CARD_KV: KVNamespace;

  // vars(wrangler.jsonc)
  PASS_TYPE_IDENTIFIER: string;
  TEAM_IDENTIFIER: string;
  ORG_NAME: string;
  CARD_TTL_HOURS: string;
  TOKEN_TTL_MINUTES: string;
  RATE_LIMIT_PER_HOUR: string;
  ALLOWED_ORIGINS: string;

  // secrets(.dev.vars / wrangler secret)
  DUMMY_SIGNING?: string; // "1" でダミー自己署名
  ADMIN_PASSCODE: string; // 発行 API のパスコード
  TOKEN_SECRET: string; // ダウンロードトークン用 HMAC 鍵
  PASS_CERT_PEM: string; // Pass Type ID 証明書 (PEM)
  PASS_KEY_PEM: string; // 上記に対応する秘密鍵 (PEM)
  PASS_KEY_PASSPHRASE?: string; // 秘密鍵パスフレーズ(任意)
  WWDR_CERT_PEM: string; // Apple WWDR 中間証明書 (PEM)
}

/** pass.json の配色(仕様書「配色」表) */
export const PASS_COLORS = {
  backgroundColor: "rgb(38, 32, 85)", // #262055 紫紺
  foregroundColor: "rgb(255, 255, 255)", // 白
  labelColor: "rgb(159, 225, 203)", // #9FE1CB ミント
} as const;

/** Wallet パスの多言語対応(端末言語で自動切替)。対象6言語 */
export const PASS_LANGS = ["ja", "en", "zh-Hans", "pt", "es", "th"] as const;
export type PassLang = (typeof PASS_LANGS)[number];

/**
 * pass.strings のラベル翻訳(仕様書「多言語対応」表)。
 * pass.json 側の label にはキー名を書き、各 {lang}.lproj/pass.strings で翻訳する。
 */
export const PASS_STRINGS: Record<PassLang, Record<string, string>> = {
  ja: { NAME_LABEL: "お名前", ID_LABEL: "カルテ番号", ISSUED_LABEL: "発行日" },
  en: { NAME_LABEL: "Name", ID_LABEL: "Patient ID", ISSUED_LABEL: "Issued" },
  "zh-Hans": { NAME_LABEL: "姓名", ID_LABEL: "病历号", ISSUED_LABEL: "发行日" },
  pt: { NAME_LABEL: "Nome", ID_LABEL: "Nº do prontuário", ISSUED_LABEL: "Emitido em" },
  es: { NAME_LABEL: "Nombre", ID_LABEL: "Nº de historia", ISSUED_LABEL: "Emisión" },
  th: { NAME_LABEL: "ชื่อ", ID_LABEL: "หมายเลขผู้ป่วย", ISSUED_LABEL: "วันที่ออก" },
};

/** 裏面(backFields)※日本語固定(仕様書「裏面」表) */
export const BACK_FIELDS = [
  {
    key: "hours",
    label: "診療時間",
    value: "月〜土 9:00–19:00(受付は18:45まで)/ 日曜・祝日 休診",
  },
  { key: "address", label: "住所", value: "〒231-0806 神奈川県横浜市中区本牧1-7" },
  { key: "tel", label: "電話", value: "045-623-6633" },
  { key: "web", label: "ホームページ", value: "https://www.minato6633.com" },
  {
    key: "notice",
    label: "ご案内",
    value: "保険証・マイナンバーカードを毎回ご提示ください",
  },
] as const;

/** 発行レコードの状態 */
export type CardStatus = "issued" | "added" | "expired";
