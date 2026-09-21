# FlightLogbook — JCAB 飛行日誌 on Google Sheets

Apple Numbers で管理していた飛行日誌を、Google スプレッドシート + Apps Script の Web UI に移行するプロジェクトです。
設計方針・データ仕様は [AGENT.md](AGENT.md) を参照してください。

## できること

- Web UI からレグを入力（OUT/IN 時刻から飛行時間を自動計算、PIC / SIC / 分割 / SIM プリセットで JCAB 各欄に自動配分）
- 月ごとの一覧・編集・削除、項小計 / 前項までの合計 / 合計 の表示
- 年間の月別集計、型式別時間、直近 N 日の時間・離着陸回数
- JCAB 様式（29 列・2 段ヘッダー・3 段合計）の月次シート「飛行日誌_YYYY-MM」を生成
- 旧 Numbers データ（2017-08 〜 2024-10, 860 レグ）の CSV 取込と繰越合計の設定

## セットアップ手順

### 1. 旧データを書き出す（PC 側、1 回だけ）

```bash
pip install numbers-parser
python tools/export_numbers.py "FLIGHT LOGBOOK.numbers"
```

`data/flights.csv` と `data/carry_forward.json` ができます（リポジトリに同梱済み）。

### 2. Google スプレッドシートと Apps Script を作る

1. Google ドライブで新しいスプレッドシートを作成（名前は任意。例: `飛行日誌`）。
2. メニュー「拡張機能 > Apps Script」を開く。
3. `src/` 配下のファイルを同じ名前で作成し、内容を貼り付ける。
   - `Code.gs` `Schema.gs` `Util.gs` `Api.gs` `Totals.gs` `Report.gs` `Import.gs` → 「スクリプト」ファイル
   - `Index.html` `Style.html` `Script.html` → 「HTML」ファイル
   - `appsscript.json` は「プロジェクトの設定 > マニフェストを表示」で内容を置き換える
4. （clasp を使う場合）`npm i -g @google/clasp && clasp login`、`.clasp.json.example` を `.clasp.json` にコピーして `scriptId` を入れ、`clasp push`。

### 3. 初期化とデプロイ

1. Apps Script エディタで関数 `setupSpreadsheet` を選んで実行（初回は権限承認）。`Flights` / `Aircraft` / `Airports` / `Settings` シートが作られます。
2. 「デプロイ > 新しいデプロイ > 種類: ウェブアプリ」
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **自分のみ**
3. 表示された `/exec` URL を開くと UI が起動します（スマホでも可）。

### 4. 旧データを取り込む

1. UI の「設定・取込」タブ → 「CSV 取込」で `data/flights.csv` を選び「取込実行」。
2. 同タブの「繰越合計」に `data/carry_forward.json` の値を入力して「設定を保存」
   （または Apps Script エディタで `apiImportCarryForward('<json の中身>')` を 1 回実行）。
3. 「集計」タブの累計が Numbers 版 2024 年 10 月の「合計」行（飛行時間 12875:33、離陸 2043、着陸 2049）と一致することを確認。

## GitHub Pages でフロントエンドを使う（任意）

Apps Script の HtmlService 画面の代わりに、同じ UI を GitHub Pages（`docs/index.html`）から使えます。
データと集計ロジックは引き続き Apps Script 側（`doPost` の JSON API）にあり、静的ページは fetch で呼ぶだけです。

1. **API を公開デプロイする**: Apps Script「デプロイ > 新しいデプロイ > ウェブアプリ」で
   「次のユーザーとして実行: 自分」「アクセスできるユーザー: **全員**」にする（既存デプロイなら「編集」で変更）。
   匿名アクセスになる代わりに、次のトークンで保護されます。
2. **トークンを作る**: エディタで関数 `generateApiToken` を実行し、「実行ログ」に出た `API_TOKEN = …` を控える。
3. **静的ページをビルドして push する**:

   ```bash
   python tools/build_pages.py
   git add docs src tools dev AGENT.md README.md .gitignore .claspignore .clasp.json.example .claude
   git commit -m "Add JCAB logbook app and GitHub Pages front-end"
   git push origin main
   ```

4. GitHub のリポジトリ「Settings > Pages > Build and deployment」で
   Source = **Deploy from a branch**, Branch = **main**, Folder = **/docs** を選んで保存。
5. 数分後に `https://<ユーザー名>.github.io/FlightLogbook/` を開き、上部の接続設定に
   ウェブアプリ URL（`…/exec`）とトークンを入力して「接続」。設定はその端末のブラウザ（localStorage）にだけ保存されます。

注意:
- `.gitignore` により `data/flights.csv` / `data/carry_forward.json` / `*.numbers` は **コミットされません**（個人の飛行記録のため）。取込は手元のファイルから行ってください。リポジトリを private にして履歴管理したい場合だけ該当行を外してください。
- トークンをリポジトリや `docs/` に書かないこと。漏れたら `generateApiToken` を再実行すれば無効化できます。
- 静的ページのソースは `src/` です。`docs/index.html` は生成物なので直接編集せず、`python tools/build_pages.py` で再生成します。

ローカルで試す場合は 2 つのサーバーを起動します:

```bash
node dev/api_server.js 8766      # Apps Script API の代替（token: dev-token、CSV を自動投入）
python dev/serve.py 8765         # http://localhost:8765/docs/ に URL http://localhost:8766/api と dev-token を入力
```

## 日々の使い方

- **入力**: 月日・型式・登録記号・出発/到着・OUT/IN（UTC）・便名を入れ、乗務区分を選んで保存。保存後は到着地が次の出発地に自動セットされます。「復路を作成」で出発/到着を入れ替えた次レグを作れます。
- **一覧・編集**: 月を選んで確認。行の「編集」で入力タブに読み込み、「削除」で削除。
- **帳票**: 月を選んで「生成」。スプレッドシートに `飛行日誌_YYYY-MM` シートができるので、そちらから印刷 / PDF 出力してください。

## 開発

```bash
node tools/test_logic.js     # サーバーロジック + JSON API の回帰テスト（Apps Script 不要）
python dev/serve.py 8765     # http://localhost:8765/ で HtmlService 版 UI をローカル実行（CSV を自動投入）
node dev/api_server.js 8766  # 静的版 UI 用のローカル API（http://localhost:8765/docs/ から接続）
python tools/build_pages.py  # docs/index.html を再生成
```

旧 Numbers ファイルはリポジトリの 1 つ上の階層（`../FLIGHT LOGBOOK.numbers`）に置く想定です:

```bash
python tools/export_numbers.py "../FLIGHT LOGBOOK.numbers"
```

詳細は [AGENT.md](AGENT.md)。
