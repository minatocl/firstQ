/**
 * ローカル wrangler dev に対する end-to-end テスト。
 *   issue → verify → pass 取得 → .pkpass を展開して manifest/署名/pass.json を検証。
 * 使い方: 別ターミナルで `npm run dev` を起動後、`npm run test:e2e`
 */
import { unzipSync } from "fflate";
import forge from "node-forge";
import { writeFile } from "node:fs/promises";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const PASSCODE = process.env.ADMIN_PASSCODE || "1234";

let failures = 0;
function ok(cond, msg) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

const CHART = "10012";
const PATIENT = { name: "港 太郎", phone: "090-1234-5678", dob: "1988-04-05", lang: "ja" };
const CODE = "A12";

const AUTH = { "Content-Type": "application/json", "X-Passcode": PASSCODE };
const postJson = (path, headers, body) =>
  fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

async function main() {
  // 0) health
  const h = await (await fetch(`${BASE}/api/card/health`)).json();
  ok(h.ok === true, `health ok (signing=${h.signing})`);

  // 1) 認証なし発行は 401
  const noauth = await fetch(`${BASE}/api/card/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chartNo: CHART, ...PATIENT, code: CODE }),
  });
  ok(noauth.status === 401, "issue without passcode → 401");

  // 2) 発行
  const issue = await fetch(`${BASE}/api/card/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Passcode": PASSCODE },
    body: JSON.stringify({ chartNo: CHART, ...PATIENT, code: CODE }),
  });
  const issueJson = await issue.json();
  ok(issue.status === 200 && issueJson.ok, "issue → 200 ok");
  ok(issueJson.chartNo === CHART, "issue returns chartNo");

  // 3) 誤った生年月日 → nomatch
  const wrong = await (
    await fetch(`${BASE}/api/card/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: PATIENT.phone, dob: "2000-01-01" }),
    })
  ).json();
  ok(wrong.ok === false && wrong.reason === "nomatch", "verify wrong dob → nomatch");

  // 4) 正しい照合 → token
  const verify = await (
    await fetch(`${BASE}/api/card/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "09012345678", dob: PATIENT.dob }),
    })
  ).json();
  ok(verify.ok === true && !!verify.token, "verify correct → token");
  ok(verify.name === PATIENT.name, "verify returns name");

  // 5) pass 取得
  const passRes = await fetch(`${BASE}/api/card/pass/${verify.token}`);
  ok(passRes.status === 200, "pass → 200");
  ok(
    passRes.headers.get("content-type") === "application/vnd.apple.pkpass",
    "content-type is vnd.apple.pkpass",
  );
  const buf = new Uint8Array(await passRes.arrayBuffer());
  await writeFile("/tmp/minato-card.pkpass", buf);
  console.log(`  saved /tmp/minato-card.pkpass (${buf.length} bytes)`);

  // 6) トークン再利用は不可(1回消込)
  const reuse = await fetch(`${BASE}/api/card/pass/${verify.token}`);
  ok(reuse.status === 410, "token reuse → 410");

  // 7) .pkpass 展開して検証
  const files = unzipSync(buf);
  const names = Object.keys(files);
  const required = [
    "pass.json",
    "manifest.json",
    "signature",
    "icon.png",
    "icon@2x.png",
    "icon@3x.png",
    "logo.png",
    "ja.lproj/pass.strings",
    "en.lproj/pass.strings",
    "th.lproj/pass.strings",
  ];
  for (const r of required) ok(names.includes(r), `contains ${r}`);

  // manifest の SHA-1 が各ファイルと一致
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  let manifestOk = true;
  for (const [fn, hash] of Object.entries(manifest)) {
    const md = forge.md.sha1.create();
    md.update(forge.util.binary.raw.encode(files[fn]));
    if (md.digest().toHex() !== hash) {
      manifestOk = false;
      console.log(`    manifest mismatch: ${fn}`);
    }
  }
  ok(manifestOk, "manifest SHA-1 matches all files");

  // pass.json の中身
  const pass = JSON.parse(new TextDecoder().decode(files["pass.json"]));
  ok(pass.serialNumber === CHART, "pass.json serialNumber = chartNo");
  ok(pass.barcodes?.[0]?.message === CHART, "barcode message = chartNo (数字のみ)");
  ok(pass.backgroundColor === "rgb(38, 32, 85)", "backgroundColor 紫紺");
  ok(pass.labelColor === "rgb(159, 225, 203)", "labelColor ミント");
  ok(
    pass.generic?.primaryFields?.[0]?.label === "NAME_LABEL",
    "primaryField label はキー名(多言語 lproj で翻訳)",
  );

  // 署名が DER PKCS#7 として parse でき、署名者を含む
  try {
    const der = forge.util.createBuffer(forge.util.binary.raw.encode(files["signature"]));
    const asn1 = forge.asn1.fromDer(der);
    const p7 = forge.pkcs7.messageFromAsn1(asn1);
    ok(!!p7 && Array.isArray(p7.certificates) && p7.certificates.length >= 1, "signature は有効な PKCS#7(証明書同梱)");
  } catch (e) {
    ok(false, "signature parse: " + e.message);
  }

  // 8) カルテ番号5桁バリデーション
  const bad6 = await (await postJson("/api/card/issue", AUTH, {
    chartNo: "123456", name: "六桁", phone: "07000000000", dob: "2000-01-01", code: "C99",
  })).json();
  ok(bad6.error === "invalid_chartNo", "6桁カルテ番号 → invalid_chartNo");
  const bad4 = await (await postJson("/api/card/issue", AUTH, {
    chartNo: "1234", name: "四桁", phone: "07000000001", dob: "2000-01-01", code: "C98",
  })).json();
  ok(bad4.error === "invalid_chartNo", "4桁カルテ番号 → invalid_chartNo");

  // 9) 番号変更の再発行 → 旧番号は照合で無効・statuses は新番号
  const codeR = "R01", phoneR = "070-1111-2222", dobR = "1975-08-08";
  await postJson("/api/card/issue", AUTH, { chartNo: "55501", name: "再発 一郎", phone: phoneR, dob: dobR, code: codeR });
  await postJson("/api/card/issue", AUTH, { chartNo: "55502", name: "再発 一郎", phone: phoneR, dob: dobR, code: codeR });
  const vR = await (await postJson("/api/card/verify", { "Content-Type": "application/json" }, { phone: phoneR, dob: dobR })).json();
  ok(vR.ok === true && !vR.multiple, "番号変更後の照合は単一一致(旧番号は失効)");
  const stR = await (await postJson("/api/card/statuses", AUTH, { codes: [codeR] })).json();
  ok(stR.statuses[codeR]?.chartNo === "55502", "statuses は新番号 55502 を返す");

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
