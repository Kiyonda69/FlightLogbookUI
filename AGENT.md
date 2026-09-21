# AGENT.md — FlightLogbookUI (JCAB 飛行日誌 on Google Sheets)

このファイルは AI エージェント / 開発者向けのプロジェクト指針です。作業前に必ず読むこと。

## 1. プロジェクトの目的

- 国土交通省航空局 (JCAB) 様式の **飛行日誌 (Flight Logbook)** を Google スプレッドシートで管理する。
- スプレッドシートは DB 兼帳票出力先。ロジックは Apps Script。UI は 2 系統あり、どちらも同じ `src/Index.html` + `Script.html` から作られる:
  1. **HtmlService 版** — Apps Script の `/exec` URL をそのまま開く（`google.script.run` で呼ぶ）。
  2. **GitHub Pages 版** — `docs/index.html`（`tools/build_pages.py` の生成物）。`google.script.run` を fetch のシムに差し替え、Apps Script の `doPost` JSON API を呼ぶ。
- 旧データは Apple Numbers ファイル `../FLIGHT LOGBOOK.numbers`（リポジトリの 1 階層上、2017-08 〜 2024-10、860 レグ）。`tools/export_numbers.py` で CSV 化し、Web UI から取り込む。
- 利用者は B777 (B772 / B773 / B77W) 乗務のエアラインパイロット 1 名。時刻は **UTC**。
- GitHub: `https://github.com/Kiyonda69/FlightLogbookUI`（main ブランチ、Pages は `/docs`）。

## 2. ディレクトリ構成

```
FlightLogbookUI/                    ← git リポジトリ（実体は OneDrive/Documents/FlightLogbook/FlightLogbookUI）
├── AGENT.md                 このファイル
├── README.md                利用者向けセットアップ手順
├── LICENSE                  MIT（GitHub 生成）
├── docs/
│   ├── index.html           GitHub Pages 用の静的 UI【生成物。直接編集しない】
│   └── .nojekyll
├── src/                     Apps Script プロジェクト（clasp の rootDir）
│   ├── appsscript.json      マニフェスト（timeZone=Asia/Tokyo, V8, webapp）
│   ├── Code.gs              doGet（HtmlService UI）/ doPost（JSON API, パスワード認証 + 失敗ロック）/ setApiPasswordPrompt / resetAuthLock
│   ├── Schema.gs            シート名・列定義 (FLIGHT_COLUMNS, TOTAL_KEYS, REPORT_*)・setupSpreadsheet・onOpen
│   ├── Util.gs              分/時刻/日付のパース・整形、normalizeFlight_（バリデーション）
│   ├── Api.gs               UI から呼ぶ関数 (apiBootstrap, apiGetMonth, apiAdd/Update/DeleteFlight, 設定, マスター)
│   ├── Totals.gs            項小計 / 前項までの合計 / 合計、年間集計、直近 N 日
│   ├── Report.gs            年次 JCAB 様式シート「飛行日誌_YYYY」（12 か月ブロック、Numbers の年シート相当）を書き込みのたびに自動再生成
│   ├── Import.gs            CSV / 繰越 JSON 取込（importCarryForwardFromDrive / importCarryForwardPrompt は引数なしでエディタ・メニューから実行可）
│   ├── Index.html           UI マークアップ（タブ: 入力 / 一覧・編集 / 集計 / 設定・取込）
│   ├── Style.html           CSS
│   └── Script.html          クライアント JS（google.script.run 経由でサーバー関数を呼ぶ）
├── tools/
│   ├── export_numbers.py    Numbers → data/flights.csv + data/carry_forward.json
│   ├── build_pages.py       src/ → docs/index.html（fetch シム + 接続設定パネルを注入）
│   └── test_logic.js        Node で src/*.gs をモック上で実行する回帰テスト（doPost も検証）
├── dev/
│   ├── mock_gas.js          SpreadsheetApp / Utilities / LockService / PropertiesService / ContentService の模擬
│   ├── serve.py             ローカルプレビュー (http://localhost:8765/ = HtmlService 版, /docs/ = Pages 版)
│   └── api_server.js        doPost をローカル HTTP で公開する API モック (http://localhost:8766/api, password=dev-pass)
├── data/                    【git 管理外】個人の飛行記録
│   ├── flights.csv          旧データ 860 行（列 = Flights シートのキー、時間は分）
│   └── carry_forward.json   2017-08 時点の「前項までの合計」（システム導入前累計）
├── pages.config.json        Pages ビルド設定 { "apiUrl": "<Apps Script の /exec URL>" }（パスワードは書かない）
├── .claude/launch.json      プレビューサーバー定義 (logbook-dev / logbook-api)
├── .clasp.json.example      clasp 設定の雛形（実物 .clasp.json は git 管理外）
└── .claspignore / .gitignore
```

### JSON API（`doPost`）の契約

- リクエスト: `POST <exec URL>`、本文は **text/plain** の JSON `{ "password", "fn", "args": [] }`（プリフライトを避けるため Content-Type を付けない）。
- レスポンス: `{ "ok": true, "result" }` または `{ "ok": false, "error" }`。
- 呼べるのは名前が `api` + 大文字で始まる関数のみ。末尾 `_` の内部関数や `setupSpreadsheet` は拒否。
- 認証は Script Properties の `API_PASSWORD`（ユーザーが決めた覚えやすいパスワード。利用者の判断でランダムトークン方式を廃止した）。設定はメニュー `setApiPasswordPrompt` またはスクリプトプロパティ画面。`checkPassword_` が照合し、連続 `AUTH_MAX_FAILURES` 回失敗で `AUTH_LOCK_MINUTES` 分ロック（CacheService、全体ロック。`resetAuthLock()` で解除）。
- 静的 UI 側はパスワードを localStorage の `logbook.password` に保持。API URL は `pages.config.json` の `apiUrl` をビルド時に `LOGBOOK_DEFAULT_API_URL` として埋め込む（localStorage の `logbook.apiUrl` は上書き用）。
- 初回設定は `#password=…`（任意で `&api=…`）のフラグメント付き URL でも可能。読み取り後に `history.replaceState` で URL から除去する。「共有リンクをコピー」がこの形式を生成する。
- 接続パネル（`#connBar`）を出すのは `ConnError`（未設定・fetch 失敗・HTTP エラー・非 JSON 応答・`認証エラー`）のみ。サーバー側バリデーションエラーはトーストだけ。
- Apps Script 側のデプロイは「アクセス: 全員」が必要（「自分のみ」だと別オリジンからの fetch は Google ログインへリダイレクトされて失敗する）。
- fetch は `redirect: 'follow'`（script.google.com → googleusercontent.com のリダイレクトを追う）。

## 3. データモデル（変更時は必ず 4 箇所同時に更新）

`Flights` シートの列は `src/Schema.gs` の **`FLIGHT_COLUMNS` が唯一の正**。列を足す/変える場合は次を同時に更新する:

1. `FLIGHT_COLUMNS`（順序 = シート列順、`kind` でパース方法が決まる）
2. `TOTAL_KEYS` / `REPORT_KEYS` / `REPORT_HEADER_*`（帳票に載せる場合）
3. `tools/export_numbers.py` の `NUMBERS_COLS`（旧データにも存在する場合）
4. `tools/test_logic.js` の期待値

| key | kind | JCAB 欄 |
|---|---|---|
| id | meta | （UUID、非表示） |
| date | date | 月日 (`YYYY-MM-DD` 文字列) |
| aircraft_type / registration | text | 航空機の型式 / 登録記号 |
| dep / arr | text | 出発地 / 到着地 (ICAO 4 文字) |
| dep_time / arr_time | time | 出発時刻 / 到着時刻 (`HH:MM` 文字列, UTC) |
| flight_no | text | 飛行内容（便名, SIM は M11/M21/ADVT 等） |
| takeoffs / landings | int | 離着陸回数 |
| block | min | 飛行時間 |
| pic / solo_sic / pus / pic_xc / pic_night | min | 機長・単独・副機長または機長見習業務の時間（PIC / SOLO・SIC / PUS / 野外 / 夜間） |
| sic / dual / sic_xc / sic_night | min | 副操縦士または教官同乗教育の時間（副操縦士 / 同乗教育 / 野外 / 夜間） |
| hood / ifr | min | 計器飛行時間（フード / 計器飛行） |
| sim / ftd / instructor / flight_engineer / other | min | 模擬飛行装置 / 飛行訓練装置 / 操縦教員 / 航空機関士 / その他 |
| remarks | text | 自由欄 |
| source / created_at / updated_at | meta | 由来 (`ui` / `csv:...` / `numbers:...`) と時刻 |

### 不変条件

- **時間はすべて整数「分」で保存**する。`H:MM` への整形は UI と帳票だけ。Numbers 版で「60倍」換算表を手作りしていた苦労を繰り返さない。
- **Flights シートに数式を書かない**。集計はすべて `Totals.gs` がスクリプトで計算する（Numbers 版は月ごとに `SUM` と前月参照 `11月::I62` の手貼り数式で、表の追加ごとに壊れていた）。
- `date` / `dep_time` / `arr_time` / `remarks` などテキスト列は文字列として保存。**Flights シートへの書き込みは必ず `writeFlightRows_`** を通す（対象行の B..I と AC..AF に `@` を付けてから `setValues`）。`appendRow` は使わない（書式を付けられず、自由欄 `1:30` が時刻に化ける事故が実際に起きた）。読み取り側 `cellText_` は Date / 日割り小数を `H:MM` に戻す防御を持つ。壊れたシートは `repairFlightsSheetFormats()`（メニュー）で全行書き直し。
- 飛行時間は `arr - dep`、日付跨ぎは +24h（Numbers 版の `G+(F>G)-F` と同じ）。
- 役割時間 (pic, sic, …) は `block` を超えてはならない（`normalizeFlight_` が拒否）。
- SIM/FTD セッションは `block = 0`, `takeoffs = landings = 0`, 登録記号は空でもよい（旧データに 11 行ある）。
- 帳票の 3 段合計:
  - 項小計 = 当月レグの合計
  - 前項までの合計 = `Settings` の `carry_forward_*` + 当月より前の全レグ
  - 合計 = 前項までの合計 + 項小計
- **年次シート `飛行日誌_YYYY` は手動生成しない**。`apiAddFlight` / `apiUpdateFlight` / `apiDeleteFlight` / `apiImportCsv` / `apiSaveSettings` が `refreshYearSheets_(fromYear)` を呼び、対象年とそれ以降の年（前項までの合計が変わる）を再生成する。年の初レグでシートが新規作成される。UI に帳票タブは無い（設定タブにシート一覧の表示のみ）。書き込み API は `{ flight, refreshed: [sheetName...] }` を返す。
- 再生成コストを抑える設計: レイアウト（各月ブロックの開始行と行数）と `REPORT_DESIGN_VERSION` が前回（Script Properties `report_layout_<sheet>`）と同じなら **値の `setValues` 1 回だけ**（書式・罫線・結合・列幅は残っているので触らない）。変わったとき、または `force`（メニューの「年次帳票をすべて再生成」と `repairFlightsSheetFormats`）のときだけ `clear` → 書式 → 値 → `RangeList` でスタイル・罫線 → 結合・行高・列幅、の完全再構築。`getSettings_` は実行内キャッシュ（`apiSaveSettings` で無効化）。実測: 完全再構築 約 12 秒/年、値のみ 約 2〜3 秒/年（見込み）。
- 帳票デザインは Numbers 原本のスクリーンショットに合わせてある（`Report.gs` 冒頭コメント参照）: 細い格子 + 中太の外枠、ヘッダー下と合計行上の中太線、グループ境界（I, K, L, Q, U, W, Z, AB 列の左）の中太縦線、離陸|着陸 間の点線、1 行おきの薄い縞（合計行まで連続）、合計 3 行の左側 A..G を 1 セルに結合、ヘッダー「月日／＿＿年」「航空機／の型式」「自由欄／INST」、全セル中央揃え・通常ウェイト・Noto Sans JP 10pt、列幅は `REPORT_COL_WIDTHS`。Numbers の数式由来の `0:00` 埋めは再現しない。見た目を変えたら `REPORT_DESIGN_VERSION` を上げる。
- 重複判定キー（CSV 取込）: `date | dep_time | flight_no | registration`。
- 帳票に文字列らしき値（月日 `"5.30"`、時刻 `"23:40"`）を書くときは **`setNumberFormat('@')` を `setValues` より先に**呼ぶ。後から書式を付けても Sheets は書き込み時点で `5.3` に変換してしまう（実際に起きた不具合）。`dev/mock_gas.js` はこの自動変換を模擬するので、テストで検出できる。

### 乗務区分プリセット（UI, `applyRole` in Script.html）

| 区分 | 配分 |
|---|---|
| PIC | block → pic, pic_xc（野外あり時）, 夜間 → pic_night |
| SIC | block → sic, sic_xc, 夜間 → sic_night |
| 分割 (PIC+SIC) | 指定 PIC 分 → pic/pic_xc、残り → sic/sic_xc。夜間はまず PIC 側に割当、超過分を SIC 側へ |
| SIM | block → sim、飛行時間・離着陸は 0 |

「JCAB 全項目を直接編集」を開けば任意の列を手動上書きできる。プリセットは補助であり、最終値は保存時のフォーム値。

## 4. 開発ワークフロー

```bash
# 1. 旧データを書き出す（numbers-parser が必要）
pip install numbers-parser
python tools/export_numbers.py "FLIGHT LOGBOOK.numbers"

# 2. サーバーロジックの回帰テスト（Apps Script 不要）
node tools/test_logic.js        # ALL PASSED が出ること。取込後の合計が Numbers の 2024/10 合計と一致することを検証

# 3. UI をローカルで動かす（google.script.run をモックに差し替え、CSV を自動投入）
python dev/serve.py 8765        # → http://localhost:8765/        HtmlService 版
node dev/api_server.js 8766     # → http://localhost:8765/docs/   Pages 版（build_pages.py --api-url http://localhost:8766/api でビルドし、パスワード dev-pass）

# 4. Pages 版を再生成（src/ を変えたら必ず）
python tools/build_pages.py
```

- `.gs` は V8 ランタイムの JavaScript。`node --check` で構文確認できるが、Apps Script API は `dev/mock_gas.js` に無いものを使ったらモックにも追加する。
- サーバー関数は **`api` 接頭辞 = UI 公開**、末尾 `_` = 非公開（Apps Script の慣例で `google.script.run` から呼べない）。
- Apps Script エディタの「実行」ボタンは引数を渡せない。引数を取る `api*` 関数には、必要に応じて引数なしのラッパー（例: `importCarryForwardFromDrive`）かメニュー用のプロンプト版（例: `importCarryForwardPrompt`）を用意する。新しい GAS サービス（DriveApp 等）を使ったら `dev/mock_gas.js` にも模擬を追加する。
- `src/*.gs` の読み込み順は Apps Script 上では無関係だが、`test_logic.js` と `serve.py` では `Schema → Util → Api → Totals → Report → Import → Code` の順。グローバル定数は Schema.gs にまとめる。
- UI とサーバーの契約は JSON のみ（Date オブジェクトを返さない）。

### Apps Script へのデプロイ

- clasp: `.clasp.json.example` を `.clasp.json` にコピーし `scriptId` を入れて `clasp push`。`rootDir` は `src`。
- 手動: スプレッドシート → 拡張機能 → Apps Script に `src/` の各ファイルを同名で作成（`.gs` → スクリプト、`.html` → HTML）。
- 初回: エディタから `setupSpreadsheet()` を実行 → 「デプロイ > 新しいデプロイ > ウェブアプリ（自分として実行）」。アクセスは HtmlService 版だけなら「自分のみ」、Pages 版を使うなら「全員」+ `generateApiToken()`。
- GitHub Pages: リポジトリ Settings > Pages > Deploy from a branch / main / `/docs`。
- 詳細手順は `README.md`。

## 5. 旧 Numbers ファイルの分析結果（参照用）

- シート: `2017年`〜`2024年`（各 12 月テーブル、29 列 × 2 段ヘッダー）、`各 FLT TIME`（年別合計）、`ORGNL`（空テンプレート）、`シート1`（空）、`60倍`（分換算表）。
- 各月テーブル末尾に `項 小 計` / `前項までの合計` / `合  計` の 3 行。レグが 15 行を超える月は同一テーブル内に 2 ページ目（ヘッダー再掲）。
- 2018年2月のみ 31 列（未使用の AD/AE 列が混入）。
- 2023 年以降は `月日` が文字列 `"12.3"` ではなく数値 `13.0`（日のみ）。
- `自由欄` に時間（例 `1:30:00`、SIM の実施時間など）が入っている行がある → 文字列として保持。
- 出発/到着時刻はダミー日付付き datetime（`2020-09-06 21:29`）。時刻部分のみ有効。
- 集計検証: `carry_forward.json`（2017年8月の「前項までの合計」）+ `flights.csv` 860 行 = Numbers 2024年10月「合計」行と **19 項目すべて一致**（離陸 2043 / 着陸 2049 / 飛行時間 12875:33 ほか）。

## 6. やってはいけないこと

- `../FLIGHT LOGBOOK.numbers` を書き換える・移動する。
- `docs/index.html` を直接編集する（`src/` を直して `tools/build_pages.py` で再生成）。
- `data/` や `*.numbers`、API パスワードをコミットする（`.gitignore` 済み。リポジトリは公開の可能性がある）。
- `Script.html` に `google.script.run` 以外のサーバー呼び出し手段を持ち込む（両 UI の互換が崩れる）。
- `Flights` シートの列順・見出しを Schema.gs と別に手で変える。
- 年次シート `飛行日誌_YYYY` を手編集して正とする（次の保存で上書きされる）。
- 時間を小数時間（7.5h）で保存する。分単位のみ。
- `Settings` の `carry_forward_*` を無断で変える（累計がすべてずれる）。
- 実データ（登録記号・便名・氏名・技能証明番号）を外部サービスに送る。

## 7. 今後の拡張候補（未実装）

- 年次シートの印刷設定（A4 横、ヘッダー繰り返し）の自動化。
- 年次シートの再生成を時間トリガーで非同期化（保存の応答時間が気になる場合）。
- 90 日 3 回離着陸などのカレンシー警告をヘッダーに表示（`apiRecency` は実装済み、閾値判定は未実装）。
- ICAO 空港マスターに IATA / 空港名を投入（`Airports` シートの `iata`, `name` は空）。
- 同乗教育 / 操縦教員時間の入力プリセット。
- Google Sheets 側からの入力（`onEdit` によるバリデーション）— 現状は UI 経由のみ想定。
