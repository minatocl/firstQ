# みなとクリニック デジタル診察券 実装仕様書 v2

## 概要
新患にApple Wallet形式のデジタル診察券を発行する。配布は受付常設の**固定QR**方式:
患者が固定QRを自分のスマホで読み、**携帯電話番号＋生年月日**で本人照合し、一致すれば「Walletに追加」できる。
再来時はWalletの診察券QRを受付の置き型スキャナ(キーボードエミュレーション・Enterサフィックス設定済み)にかざし、Dynamics受付画面のカルテ番号欄に自動入力される。

## 前提
- Apple Developer Program登録済み(Pass Type ID証明書 + WWDR中間証明書を取得)
- 既存インフラ: Cloudflare Worker `minato-monshin.minato-monshin.workers.dev` / GitHub Pages `minatocl.github.io/firstQ/` / Cloudflare KV
- firstQ問診票には電話番号欄・生年月日欄が既に存在する(改修不要。無ければ追加)
- Android対応(Google Wallet)はフェーズ2。本仕様はApple Walletのみ

## アーキテクチャ
```
firstQ管理画面(スタッフ)
  └─ 患者行に [カルテ番号入力欄] + [発行ボタン]
       └─ POST /api/card/issue (Worker)
            └─ KVに発行レコード作成
               card:{カルテ番号} = {氏名, 電話番号, 生年月日, 言語, 発行日時, 状態}
               ※電話番号・生年月日・氏名は問診KVから引き継ぎ

受付常設の固定QR(印刷物・全患者共通)
  └─ https://minatocl.github.io/firstQ/card/ へのリンク

患者のスマホ
  └─ 固定QRを読む → 照合ページ(6言語)
       ├─ 電話番号 + 生年月日を入力
       ├─ POST /api/card/verify (Worker)
       │    ├─ レート制限チェック
       │    ├─ KVの発行レコードと照合
       │    ├─ 複数ヒット(双子等) → 候補氏名を返し選択画面を表示
       │    └─ 一致 → 短命ダウンロードトークン(HMAC, 10分)を発行
       └─ GET /api/card/pass/{token} (Worker)
            ├─ pass.json + manifest.json 生成
            ├─ PKCS#7 detached署名(Pass Type ID証明書)
            └─ .pkpass を application/vnd.apple.pkpass で返却
                 → Safariが「Walletに追加」画面を表示
```

## 認証仕様
- 照合キー: **電話番号(完全一致・ハイフン正規化) AND 生年月日(完全一致)**
- 対象: 状態=発行済み(スタッフがカルテ番号を入れて発行ボタンを押したレコード)のみ
- 有効期間: 発行から**72時間**。期限切れは管理画面から再発行
- 同一電話番号に複数患者(親子・双子): 照合一致した候補が複数の場合のみ氏名の選択肢を表示
  (両認証要素の通過後なので氏名表示は許容。1件ならそのままWallet追加へ)
- レート制限: 同一IP・同一電話番号あたり試行5回/時。超過は一時ブロック
- ダウンロードトークン: HMAC-SHA256(カルテ番号+exp)、有効10分、1回使用でKVに消込
- 電話番号・生年月日はKVに平文保存しない(SHA-256ハッシュで照合)。氏名・カルテ番号は券面生成に必要なため保存

## pass.json 仕様

### 基本
- スタイル: `generic`
- `passTypeIdentifier`: 取得したPass Type ID(例 `pass.com.minato6633.card`)
- `teamIdentifier`: Apple DeveloperのTeam ID
- `serialNumber`: カルテ番号
- `organizationName`: みなとクリニック

### 配色
| 項目 | 値 |
|---|---|
| backgroundColor | rgb(38, 32, 85) `#262055` 紫紺 |
| foregroundColor | rgb(255, 255, 255) 白 |
| labelColor | rgb(159, 225, 203) `#9FE1CB` ミント(ブランドティール系) |

### 画像
- `logo.png` 160×19 / `logo@2x.png` 320×38 / `logo@3x.png` 480×58
  (白反転済みワードマーク。作成済み、pass-logo/フォルダ参照)
- `icon.png` / `icon@2x.png` / `icon@3x.png`: 29/58/87px。紫紺背景に白ロゴの正方形版を新規作成すること(iconは必須ファイル)

### フィールド
- primaryFields: `name` — label: NAME_LABEL, value: 患者氏名
- secondaryFields:
  - `chartNo` — label: ID_LABEL, value: カルテ番号
  - `issued` — label: ISSUED_LABEL, value: 発行日(YYYY.MM.DD)
- barcode:
  - format: `PKBarcodeFormatQR`
  - message: **カルテ番号のみ**(数字文字列。スキャナがそのままDynamicsに打鍵するため、URL・接頭辞は厳禁)
  - messageEncoding: iso-8859-1
  - altText: カルテ番号

### 裏面(backFields) ※日本語固定
| label | value |
|---|---|
| 診療時間 | 月〜土 9:00–19:00(受付は18:45まで)/ 日曜・祝日 休診 |
| 住所 | 〒231-0806 神奈川県横浜市中区本牧1-7 |
| 電話 | 045-623-6633 |
| ホームページ | https://www.minato6633.com |
| ご案内 | 保険証・マイナンバーカードを毎回ご提示ください |

## 多言語対応
### Walletパス(6言語・端末言語で自動切替)
`{lang}.lproj/pass.strings` を同梱。対象: ja, en, zh-Hans, pt, es, th

| キー | ja | en | zh-Hans | pt | es | th |
|---|---|---|---|---|---|---|
| NAME_LABEL | お名前 | Name | 姓名 | Nome | Nombre | ชื่อ |
| ID_LABEL | カルテ番号 | Patient ID | 病历号 | Nº do prontuário | Nº de historia | หมายเลขผู้ป่วย |
| ISSUED_LABEL | 発行日 | Issued | 发行日 | Emitido em | Emisión | วันที่ออก |

※ pass.stringsはUTF-8(BOM付き)推奨。フィールドlabelにキー名を書き、各lprojで翻訳。

### 照合ページ(6言語)
firstQの言語切替UIを流用。必要な文言: ページタイトル(デジタル診察券)、電話番号、生年月日、
照合ボタン、複数候補の選択案内、エラー(一致しない/期限切れ/試行超過)、成功時の案内(Walletに追加ボタンの説明)。
翻訳はfirstQの既存トーンに合わせて実装時に生成。

## firstQ管理画面の変更
1. 各患者の行に「カルテ番号」入力欄と「発行」ボタンを追加
2. 発行後はステータス表示(発行済み・追加済み・期限切れ)と「再発行」ボタン
3. QRのモーダル表示は不要(固定QR方式のため)
4. 氏名は問診データから自動取得。ローマ字/自国語氏名があればprimaryFieldsに優先使用(日本人患者は漢字)

## 固定QR台紙(別途デザイン)
- 内容: `https://minatocl.github.io/firstQ/card/` へのQR + 6言語の説明文
  (例:「お会計後、こちらを読み取ってデジタル診察券をお受け取りください」)
- サイズ: A5アクリルスタンド想定(アクセアUV直刷り、受付ポスターと同仕様)

## 受付スキャン運用(参考・実装対象外)
- 置き型2Dスキャナ(HIDキーボード、Enterサフィックス、再読み込み防止ON)をDynamics受付PCにUSB接続
- Dynamics受付画面のカルテ番号欄フォーカス状態でQRをかざす → 番号+Enter入力で受付完了

## フェーズ2(今回は実装しない)
- Google Walletパス発行(Android向け)と端末判定出し分け
- 照合ページからのPWA版診察券(Wallet非対応端末向けフォールバック)
