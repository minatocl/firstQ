# 公式 Wallet バッジ(ここに置く)

受け取りページ(`../index.html`)は、このフォルダの**各社公式バッジ SVG** を
端末・言語に応じて表示します。ファイルが無い場合は英語版 → 自前バッジの順に
自動フォールバックするので、未配置でも動作はします(見た目のみ簡易版)。

Apple・Google とも「公式アセットをそのまま使うこと。自作バッジ不可」が
ブランド規約です。下記のファイル名で保存してください。

## 置くファイル名

`{kind}-{lang}.svg`
- `kind` … `apple` または `google`
- `lang` … `ja` / `en` / `zh` / `pt` / `es` / `th`

例)`apple-ja.svg`, `google-ja.svg`, `apple-en.svg`, `google-en.svg` …

最低限 `apple-ja.svg` と `google-ja.svg`(日本語)、および
`apple-en.svg` / `google-en.svg`(英語=他言語のフォールバック)を置けば実用十分です。

## 入手先

### Apple「Apple Wallet に追加」バッジ
- ガイドライン: https://developer.apple.com/wallet/add-to-apple-wallet-guidelines/
- リソース(SVG/45ロケール): https://developer.apple.com/wallet/resources/
- 「Add to Apple Wallet badge」の SVG(日本語ロケール = `ja`)をダウンロード → `apple-ja.svg` に。
  背景が白系のため標準版でOK(本ページのボタン背景は白)。

### Google「Google ウォレットに追加」ボタン
- ガイドライン: https://developers.google.com/wallet/generic/resources/brand-guidelines
- SVG 一括 zip: https://developers.google.com/static/wallet/download-assets/add-to-wallet-svg.zip
- zip 内の日本語(`ja`)/英語(`en`)の primary ボタン SVG を `google-ja.svg` / `google-en.svg` にリネームして配置。
  黒ボタンのみ・最小高さ 48dp・角丸/余白の改変不可(そのまま使用)。

配置後は `git push`(GitHub Pages)で反映。ファイル名さえ合っていれば
ページ側のコード変更は不要です。
