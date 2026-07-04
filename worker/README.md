# minato-card — デジタル診察券(Apple Wallet)発行 Worker

みなとクリニックの新患向けデジタル診察券を発行する Cloudflare Worker。
仕様: [`../docs/digital-card-spec.md`](../docs/digital-card-spec.md)

問診 Worker(`minato-monshin`)とは**独立**しており、問診 KV スキーマに依存しない。
発行に必要な氏名・電話・生年月日・言語は `admin.html` が問診データから引き継いで送る。

## エンドポイント

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| POST | `/api/card/issue` | X-Passcode | 発行 / 再発行(スタッフ) |
| POST | `/api/card/verify` | 公開 | 電話+生年月日で照合 → ダウンロードトークン |
| GET | `/api/card/pass/:token` | 公開(トークン) | 署名済み `.pkpass` を返却 |
| POST | `/api/card/statuses` | X-Passcode | 発行状態の一括取得(admin 表示用) |
| GET | `/api/card/health` | 公開 | 稼働確認 / 署名モード表示 |

## 署名(ダミー鍵 ↔ 本番の切替)

証明書・鍵は **Worker Secrets**(`env`)から読む。コードは分岐なしでダミー/本番どちらも動く。

- **ダミー(Apple 証明書取得前)**: `DUMMY_SIGNING="1"`。`npm run gen:dummy-certs` で
  自己署名の CA(WWDR 代役)+ リーフ(Pass 証明書代役)を生成し `.dev.vars` に投入。
  `.pkpass` は構造・manifest・PKCS#7 署名とも有効(ZIP を展開して検証可能)だが、
  Apple の信頼チェーンは通らないため実機 Wallet には**追加できない**。パイプライン確認用。
- **本番(証明書取得後)**: `DUMMY_SIGNING="0"` にし、以下を実 PEM に差し替える。
  - `PASS_CERT_PEM` … Pass Type ID 証明書
  - `PASS_KEY_PEM` / `PASS_KEY_PASSPHRASE` … 対応する秘密鍵
  - `WWDR_CERT_PEM` … Apple WWDR 中間証明書

  p12 → PEM 変換例:
  ```sh
  openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out pass-cert.pem
  openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out pass-key.pem
  # WWDR は Apple 配布の .cer を PEM 化
  openssl x509 -inform der -in AppleWWDRCAG3.cer -out wwdr.pem
  ```
  併せて `wrangler.jsonc` の `PASS_TYPE_IDENTIFIER` と `TEAM_IDENTIFIER` を実値へ。

## Secrets 一覧

| 名前 | 用途 |
|---|---|
| `DUMMY_SIGNING` | `"1"` でダミー自己署名 |
| `ADMIN_PASSCODE` | 発行 API のパスコード(admin.html と共通) |
| `TOKEN_SECRET` | ダウンロードトークン & ハッシュ用 HMAC 鍵(長いランダム文字列) |
| `PASS_CERT_PEM` / `PASS_KEY_PEM` / `PASS_KEY_PASSPHRASE` / `WWDR_CERT_PEM` | 署名用証明書・鍵 |

`wrangler.jsonc` の `vars` は公開設定(識別子・TTL・レート・CORS 許可オリジン)。

## ローカル開発 & 動作確認

```sh
npm install
npm run gen:images        # pass-logo/ 取込 + icon 生成 → src/pkpass/images.ts
npm run gen:dummy-certs   # ダミー証明書 → secrets/ と .dev.vars を生成
npm run dev               # wrangler dev (http://127.0.0.1:8787)

# 別ターミナルで end-to-end テスト(issue→verify→pass→pkpass 展開検証)
npm run test:e2e
```

フロント動作確認: プロジェクト直下の `serve.mjs` で `firstQ/` を配信し、
`card/?api=http://127.0.0.1:8787` / `admin.html?cardapi=http://127.0.0.1:8787` で
ローカル Worker を叩ける(その場合 `ALLOWED_ORIGINS` にローカルオリジンを含めて `dev` 起動)。

## デプロイ(※ユーザー確認後)

```sh
wrangler kv namespace create CARD_KV            # 本番 id を wrangler.jsonc に記入
wrangler kv namespace create CARD_KV --preview  # preview_id を記入
wrangler secret put ADMIN_PASSCODE
wrangler secret put TOKEN_SECRET
wrangler secret put PASS_CERT_PEM               # 本番は実証明書
wrangler secret put PASS_KEY_PEM
wrangler secret put PASS_KEY_PASSPHRASE
wrangler secret put WWDR_CERT_PEM
wrangler secret put DUMMY_SIGNING               # 当面は "1"、本番証明書投入後 "0"
wrangler deploy
```

デプロイ後、`card/index.html` と `admin.html` の URL 定数(`CARD_API`)を
実 Worker URL に差し替えて GitHub Pages を更新する。

## データモデル(CARD_KV)

```
card:{chartNo}       発行レコード(氏名・言語・電話/生年月日ハッシュ・発行/失効時刻・状態)
codeidx:{code}       受付コード → カルテ番号
phoneidx:{phoneHash} 電話ハッシュ → カルテ番号配列(照合の候補引き当て)
dltok:{nonce}        ダウンロードトークン消込(TTL 10分, 1回)
rl:{ip}:{phoneHash}  レート制限(5回/時)
```

電話番号・生年月日は平文保存せず HMAC-SHA256 ハッシュのみ保存(照合に使用)。
氏名・カルテ番号は券面生成に必要なため保存。
