# FlightLogbookUI — JCAB 飛行日誌 on Google Sheets

Apple Numbers で管理していた飛行日誌を、Google スプレッドシート + Apps Script の Web UI に移行するプロジェクトです。
設計方針・データ仕様は [AGENT.md](AGENT.md) を参照してください。

## できること

- Web UI からレグを入力（OUT/IN 時刻から飛行時間を自動計算、PIC / SIC / 分割 / SIM プリセットで JCAB 各欄に自動配分）
- 月ごとの一覧・編集・削除、項小計 / 前項までの合計 / 合計 の表示
- 年間の月別集計、型式別時間、直近 N 日の時間・離着陸回数
- JCAB 様式（29 列・2 段ヘッダー・各月 3 段合計）の年次シート「飛行日誌_YYYY」を、レグの保存のたびに自動更新（年の初レグで自動作成）
- 旧 Numbers データ（2017-08 〜 2024-10, 860 レグ）の CSV 取込と繰越合計の設定

## セットアップ手順

### 1. 旧データを書き出す（PC 側、1 回だけ）

```bash
pip install numbers-parser
python tools/export_numbers.py "../FLIGHT LOGBOOK.numbers"
```

`data/flights.csv`（860 レグ）と `data/carry_forward.json` ができます。
`data/` は個人の飛行記録のため git 管理外（`.gitignore`）です。PC を替えたり再クローンした場合は、このコマンドを再実行するか `data/` を手でコピーしてください。

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
2. 繰越合計（システム導入前の累計）を設定する。次のいずれか 1 つ:
   - **Apps Script エディタから**: `data/carry_forward.json` を Google ドライブにアップロードし、関数 `importCarryForwardFromDrive` を実行（初回はドライブの権限承認）。実行ログに取込結果が出ます。
   - **スプレッドシートのメニューから**: 「飛行日誌 > 繰越合計を取込 (JSON 貼り付け)」を開き、`carry_forward.json` の内容を貼り付けて OK。
   - **UI から**: 「設定・取込」タブの「繰越合計」に値を手入力して「設定を保存」。
3. 「集計」タブの累計が Numbers 版 2024 年 10 月の「合計」行（飛行時間 12875:33、離陸 2043、着陸 2049）と一致することを確認。

## GitHub Pages でフロントエンドを使う（任意）

Apps Script の HtmlService 画面の代わりに、同じ UI を GitHub Pages（`docs/index.html`）から使えます。
データと集計ロジックは引き続き Apps Script 側（`doPost` の JSON API）にあり、静的ページは fetch で呼ぶだけです。

1. **API を公開デプロイする**: Apps Script「デプロイ > 新しいデプロイ > ウェブアプリ」で
   「次のユーザーとして実行: 自分」「アクセスできるユーザー: **全員**」にする（既存デプロイなら「編集」で変更）。
   匿名アクセスになる代わりに、次のパスワードで保護されます。
2. **パスワードを決める**: スプレッドシートのメニュー「飛行日誌 > API パスワードを設定」で 4 文字以上の任意のパスワードを入力
   （Apps Script の「プロジェクトの設定 > スクリプト プロパティ」で `API_PASSWORD` を直接編集しても同じ）。
   **承知の上のリスク**: URL は公開されるため、守っているのはこのパスワードだけです。連続 20 回失敗すると 10 分間ロックされます
   （ロックは全員に掛かるので、自分が締め出されたらエディタで `resetAuthLock` を実行）。他サービスと同じパスワードは使わないでください。
3. **ウェブアプリ URL をページに埋め込んでビルドし、push する**:
   `pages.config.json` の `apiUrl` にデプロイで表示された `…/exec` URL を書いてからビルドします
   （URL は秘密ではありません。守るべきはパスワードだけです）。

   ```bash
   python tools/build_pages.py
   git add -A
   git commit -m "Build GitHub Pages front-end"
   git push origin main
   ```

4. GitHub のリポジトリ「Settings > Pages > Build and deployment」で
   Source = **Deploy from a branch**, Branch = **main**, Folder = **/docs** を選んで保存。
5. 数分後に `https://<ユーザー名>.github.io/FlightLogbookUI/` を開き、上部の接続設定に **パスワードだけ** 入力して「接続」。
   パスワードはその端末のブラウザ（localStorage）に保存され、次回以降の入力は不要です。

**他の端末（スマホ等）の設定**: パスワードを入力するか、設定済みの端末で「接続設定 > 共有リンクをコピー」を押して得られる
`https://…/FlightLogbookUI/#password=…` 形式のリンクを 1 回開きます。パスワードが保存され、URL からは自動で消えます。
ブックマークやホーム画面追加はその後に行ってください。

注意:
- `.gitignore` により `data/flights.csv` / `data/carry_forward.json` / `*.numbers` は **コミットされません**（個人の飛行記録のため）。取込は手元のファイルから行ってください。リポジトリを private にして履歴管理したい場合だけ該当行を外してください。
- パスワードをリポジトリや `docs/` に書かないこと。漏れたらメニューから変更すれば無効化できます（全端末で再入力が必要）。
- 静的ページのソースは `src/` です。`docs/index.html` は生成物なので直接編集せず、`python tools/build_pages.py` で再生成します。
- 接続パネルは未設定・ネットワーク断・認証エラーのときだけ自動表示されます。プライベートブラウズ（シークレットモード）では localStorage が閉じるたびに消えるため、毎回入力になります。通常モードで使ってください。

ローカルで試す場合は 2 つのサーバーを起動します:

```bash
node dev/api_server.js 8766      # Apps Script API の代替（パスワード: dev-pass、CSV を自動投入）
python tools/build_pages.py --api-url http://localhost:8766/api   # ローカル API 向けにビルド（コミット前に引数なしで再ビルド）
python dev/serve.py 8765         # http://localhost:8765/docs/ を開きパスワード dev-pass を入力
```

## 日々の使い方

- **入力**: 月日・型式・登録記号・出発/到着・OUT/IN（UTC）・便名を入れ、乗務区分を選んで保存。保存後は到着地が次の出発地に自動セットされます。「復路を作成」で出発/到着を入れ替えた次レグを作れます。
- **一覧・編集**: 月を選んで確認。行の「編集」で入力タブに読み込み、「削除」で削除。
- **データ修復**: Flights シートの自由欄などに `1:30` のような値が時刻として保存されてしまった場合（初期の取込で発生）、メニュー「飛行日誌 > Flights シートの書式を修復」を 1 回実行すると全行をテキストとして書き直し、年次シートも再生成します。
- **帳票**: 操作は不要です。保存・編集・削除のたびにスプレッドシートの `飛行日誌_YYYY` シート（1月〜12月、各月に項小計 / 前項までの合計 / 合計）が更新され、新しい年の最初のレグでその年のシートが作られます。前年以前を編集すると、それ以降の年のシートも連鎖して更新されます。印刷 / PDF 出力はスプレッドシート側で行ってください。コード更新後などに作り直したいときはメニュー「飛行日誌 > 年次帳票をすべて再生成」。

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
