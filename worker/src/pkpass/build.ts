/**
 * .pkpass(ZIP)の組み立て。
 *   pass.json / {lang}.lproj/pass.strings / 画像 / manifest.json / signature
 * を作り、fflate で ZIP 化して返す。
 */
import { zipSync } from "fflate";
import forge from "node-forge";
import {
  BACK_FIELDS,
  PASS_COLORS,
  PASS_LANGS,
  PASS_STRINGS,
  type Env,
} from "../config";
import type { CardRecord } from "../kv";
import { PASS_IMAGES } from "./images";
import { signManifest } from "./sign";

const enc = new TextEncoder();

/** epoch ms → "YYYY.MM.DD"(発行日表示) */
function fmtIssued(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function buildPassJson(rec: CardRecord, env: Env): Uint8Array {
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: env.PASS_TYPE_IDENTIFIER,
    teamIdentifier: env.TEAM_IDENTIFIER,
    organizationName: env.ORG_NAME,
    serialNumber: rec.chartNo,
    description: "デジタル診察券",
    // 配色
    backgroundColor: PASS_COLORS.backgroundColor,
    foregroundColor: PASS_COLORS.foregroundColor,
    labelColor: PASS_COLORS.labelColor,
    // フィールド(label はキー名。翻訳は各 lproj/pass.strings)
    generic: {
      primaryFields: [{ key: "name", label: "NAME_LABEL", value: rec.name }],
      secondaryFields: [
        { key: "chartNo", label: "ID_LABEL", value: rec.chartNo },
        { key: "issued", label: "ISSUED_LABEL", value: fmtIssued(rec.issuedAt) },
      ],
      backFields: BACK_FIELDS.map((f) => ({ key: f.key, label: f.label, value: f.value })),
    },
    // バーコード: カルテ番号のみ(接頭辞・URL 厳禁)。新旧両フォーマットを併記。
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: rec.chartNo,
        messageEncoding: "iso-8859-1",
        altText: rec.chartNo,
      },
    ],
    barcode: {
      format: "PKBarcodeFormatQR",
      message: rec.chartNo,
      messageEncoding: "iso-8859-1",
      altText: rec.chartNo,
    },
  };
  return enc.encode(JSON.stringify(pass, null, 2));
}

/** {lang}.lproj/pass.strings(UTF-8 BOM 付き) */
function buildStrings(lang: string): Uint8Array {
  const dict = PASS_STRINGS[lang as keyof typeof PASS_STRINGS];
  const body = Object.entries(dict)
    .map(([k, v]) => `"${k}" = "${v.replace(/"/g, '\\"')}";`)
    .join("\n");
  const bom = "﻿";
  return enc.encode(bom + body + "\n");
}

/** ファイル名 → SHA-1(hex)。Apple の manifest 仕様は SHA-1。 */
function sha1Hex(bytes: Uint8Array): string {
  const md = forge.md.sha1.create();
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  md.update(bin);
  return md.digest().toHex();
}

/**
 * 発行レコードから署名済み .pkpass(Uint8Array)を生成する。
 */
export function buildPkpass(rec: CardRecord, env: Env): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  files["pass.json"] = buildPassJson(rec, env);

  // 画像(pass-logo + 生成 icon)。images.ts は base64 を持つ。
  for (const [name, b64] of Object.entries(PASS_IMAGES)) {
    files[name] = base64ToU8(b64);
  }

  // 多言語 pass.strings
  for (const lang of PASS_LANGS) {
    files[`${lang}.lproj/pass.strings`] = buildStrings(lang);
  }

  // manifest.json = 全ファイルの SHA-1
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    manifest[name] = sha1Hex(bytes);
  }
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  files["manifest.json"] = manifestBytes;

  // signature: manifest への PKCS#7 detached 署名
  files["signature"] = signManifest(manifestBytes, env);

  return zipSync(files, { level: 6 });
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
