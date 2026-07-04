/**
 * ダミー自己署名証明書の生成(Apple 証明書取得前の動作確認用)。
 *   - ルート CA(WWDR 中間証明書の代役)
 *   - リーフ証明書(Pass Type ID 証明書の代役, CA が署名)
 * 本番と同じ「リーフ + 中間」チェーン構造になるので、実証明書に差し替えても
 * Worker 側のコードは変更不要。
 *
 * 使い方: npm run gen:dummy-certs
 * 生成物: worker/secrets/*.pem と、未作成なら worker/.dev.vars を自動生成。
 */
import forge from "node-forge";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerDir = join(__dirname, "..");
const secretsDir = join(workerDir, "secrets");

function makeCert(subjectCN, issuerCert, issuerKey, isCA) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1e16));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);
  const attrs = [
    { name: "commonName", value: subjectCN },
    { name: "organizationName", value: "Minato Clinic (DUMMY)" },
    { name: "countryName", value: "JP" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(issuerCert ? issuerCert.subject.attributes : attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: !!isCA },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyCertSign: !!isCA,
      cRLSign: !!isCA,
    },
    ...(isCA ? [] : [{ name: "extKeyUsage", clientAuth: true, emailProtection: true }]),
  ]);
  cert.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(secretsDir, { recursive: true });

  console.log("ダミー CA を生成中...");
  const ca = makeCert("Minato Dummy WWDR CA", null, null, true);
  console.log("ダミー Pass 証明書(リーフ)を生成中...");
  const leaf = makeCert("Pass Type ID DUMMY", ca.cert, ca.key, false);

  const caPem = forge.pki.certificateToPem(ca.cert);
  const leafPem = forge.pki.certificateToPem(leaf.cert);
  const leafKeyPem = forge.pki.privateKeyToPem(leaf.key);

  await writeFile(join(secretsDir, "wwdr-ca.pem"), caPem);
  await writeFile(join(secretsDir, "pass-cert.pem"), leafPem);
  await writeFile(join(secretsDir, "pass-key.pem"), leafKeyPem);
  console.log(`\n証明書を ${secretsDir} に保存しました。`);

  const devVarsPath = join(workerDir, ".dev.vars");
  const block =
    `DUMMY_SIGNING="1"\n` +
    `ADMIN_PASSCODE="1234"\n` +
    `TOKEN_SECRET="dev-only-${forge.util.bytesToHex(forge.random.getBytesSync(24))}"\n\n` +
    `PASS_CERT_PEM="${leafPem.trim()}"\n\n` +
    `PASS_KEY_PEM="${leafKeyPem.trim()}"\n\n` +
    `PASS_KEY_PASSPHRASE=""\n\n` +
    `WWDR_CERT_PEM="${caPem.trim()}"\n`;

  if (await exists(devVarsPath)) {
    const snippet = join(secretsDir, "dev-vars-snippet.txt");
    await writeFile(snippet, block);
    console.log(
      `\n.dev.vars は既に存在します。上書きしませんでした。\n` +
        `→ 生成した設定を ${snippet} に出力しました。必要な行を .dev.vars に反映してください。`,
    );
  } else {
    await writeFile(devVarsPath, block);
    console.log(`\n.dev.vars を自動生成しました: ${devVarsPath}`);
  }
  console.log("\n完了。`npm run dev` でローカル起動できます。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
