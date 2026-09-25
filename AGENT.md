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
│   ├── Crew.gs              CrewRules.html をサーバー側で評価 (loadCrewRules_, apiCrewPatterns, apiAllocateCrew)
│   ├── Qual.gs              「資格要件チェックリスト」シート（CAP 様式 A1:J27 の再現）を飛行日誌と設定から自動更新
│   ├── CrewRules.html       【共有】編成パターン表 CREW_PATTERNS と allocateCrew()（UI とサーバーの唯一の正）
│   ├── Index.html           UI マークアップ（タブ: 入力 / 一覧・編集 / 集計 / 設定・取込）
│   ├── Style.html           CSS
│   └── Script.html          クライアント JS（google.script.run 経由でサーバー関数を呼ぶ）
├── tools/
│   ├── export_numbers.py    Numbers → data/flights.csv + data/carry_forward.json
│   ├── build_pages.py       src/ → docs/index.html（fetch シム + 接続設定パネルを注入）
│   ├── test_logic.js        Node で src/*.gs をモック上で実行する回帰テスト（doPost も検証）
│   ├── setup_clasp.ps1      新しいマシンの clasp 環境構築（clasp 導入・.clasp.json・login・status）
│   └── clasp_deploy.ps1     src/ を Apps Script へ push --force し、Pages 用デプロイを新バージョンに更新
├── dev/
│   ├── mock_gas.js          SpreadsheetApp / Utilities / LockService / PropertiesService / ContentService の模擬
│   ├── serve.py             ローカルプレビュー (http://localhost:8765/ = HtmlService 版, /docs/ = Pages 版)
│   └── api_server.js        doPost をローカル HTTP で公開する API モック (http://localhost:8766/api, password=dev-pass)
├── data/                    【git 管理外】個人の飛行記録
│   ├── flights.csv          旧データ 860 行（列 = Flights シートのキー、時間は分）
│   └── carry_forward.json   2017-08 時点の「前項までの合計」（システム導入前累計）
├── pages.config.json        Pages ビルド設定 { "apiUrl": "<Apps Script の /exec URL>" }（パスワードは書かない）
├── .claude/launch.json      プレビューサーバー定義 (logbook-dev / logbook-api)
├── .clasp.json.example      clasp 設定（本番 scriptId 入り）。tools/setup_clasp.ps1 が .clasp.json（git 管理外）にコピー
├── .claspignore             clasp 3 用（rootDir=src からの相対。.gs / .html / appsscript.json のみ push）
└── .gitignore
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
| crew | text | 編成コード `M2/0`（パターン id / 自分の位置）, `SPLIT`, `SIM`, 旧データは空。帳票には出さない |
| qpr | text | QPR フライトなら `'1'`、それ以外は空（`normalizeFlight_` が true / 1 / yes / ○ を `'1'` に正規化）。帳票には出さず、資格要件チェックリスト シートの **ROUTE CHK 欄**（前回実施日・年度別実施日・基準月）と集計タブの「ROUTE CHK / QPR (年度)」に反映 |
| sim_takeoffs / sim_landings | int | SIM/FTD セッションの離着陸回数（`SIM_COUNT_KEYS`）。**`takeoffs` / `landings` の合計には含めず別に集計**（ユーザー指示）。帳票の離着陸回数欄に `(1)` のように記入 |

列を末尾に追加したときは `ensureFlightsHeader_`（`setupSpreadsheet` と書式修復が呼ぶほか、`readAllFlights_` / `writeFlightRows_` が列数不足を検知すると自動で呼ぶ）が既存シートに見出しとテキスト書式を追加する。コードを貼り直しただけで既存シートがそのまま使える（`qpr` 列追加時に確認）。

### 不変条件

- **時間はすべて整数「分」で保存**する。`H:MM` への整形は UI と帳票だけ。Numbers 版で「60倍」換算表を手作りしていた苦労を繰り返さない。
- **Flights シートに数式を書かない**。集計はすべて `Totals.gs` がスクリプトで計算する（Numbers 版は月ごとに `SUM` と前月参照 `11月::I62` の手貼り数式で、表の追加ごとに壊れていた）。
- `Settings` の値も同じ問題がある: `put()` は値セルに `@` を付けてから書き、`readSettings_` は Date になってしまった値を `settingText_` で `yyyy-mm-dd`（スクリプトのタイムゾーン）に戻す。Date を JSON にすると `2027-04-06T15:00:00Z` と 1 日ずれるので、Date を生で返してはいけない（実際に起きた不具合）。
- `date` / `dep_time` / `arr_time` / `remarks` などテキスト列は文字列として保存。**Flights シートへの書き込みは必ず `writeFlightRows_`** を通す（対象行の B..I と AC..AF に `@` を付けてから `setValues`）。`appendRow` は使わない（書式を付けられず、自由欄 `1:30` が時刻に化ける事故が実際に起きた）。読み取り側 `cellText_` は Date / 日割り小数を `H:MM` に戻す防御を持つ。壊れたシートは `repairFlightsSheetFormats()`（メニュー）で全行書き直し。
- 飛行時間は `arr - dep`、日付跨ぎは +24h（Numbers 版の `G+(F>G)-F` と同じ）。
- 役割時間 (pic, sic, …) は `block` を超えてはならない（`normalizeFlight_` が拒否）。
- SIM/FTD セッションは `block = 0`, `takeoffs = landings = 0`, 登録記号は空でもよい（旧データに 11 行ある）。
- SIM の離着陸回数は `sim_takeoffs` / `sim_landings` に入れる（`normalizeFlight_` が 0 以上の整数か、SIM/FTD セッション = 飛行時間 0 かを検査し、実飛行への入力は拒否）。`TOTAL_KEYS` には入れない: 集計オブジェクト（`zeroTotals_` / `addTotals_` / `sumTotals_`）は `TOTAL_KEYS + SIM_COUNT_KEYS` を足すので項小計・前項までの合計・合計・累計・年計・直近 N 日には `sim_*` が別キーとして載るが、`takeoffs` / `landings` には一切加算しない。繰越（`carry_forward_*`）は無し。90 日離着陸（資格要件）も実機の `landings` のみ。
- 帳票の離陸・着陸列 (I:J) は **テキスト書式 `@`**（`countText_` が文字列を書く）。SIM レグは `(3)`、合計行は SIM 分があれば `2043 (12)` / `0 (3)`、無ければ `2043`。Sheets は `(1)` を数値 -1 と解釈するため `@` が必須（`dev/mock_gas.js` もこの変換を模擬）。列幅は `2043 (12)` が収まる 68px。UI（一覧・合計行・ヘッダー・集計）も同じ表記（`Script.html` の `cnt()`）。
- Apps Script はファイルの評価順を保証しないので、トップレベルで他ファイルのグローバル（例: `TOTAL_KEYS`）を使った `var` 初期化をしない（`Totals.gs` の `summedKeys_()` は初回呼び出し時に作る）。
- 帳票の 3 段合計:
  - 項小計 = 当月レグの合計
  - 前項までの合計 = `Settings` の `carry_forward_*` + 当月より前の全レグ
  - 合計 = 前項までの合計 + 項小計
- **年次シート `飛行日誌_YYYY` は手動生成しない**。`apiAddFlight` / `apiUpdateFlight` / `apiSaveFlights` / `apiDeleteFlight` / `apiImportCsv` / `apiSaveSettings` が `refreshYearSheets_(fromYear)` を呼び、対象年とそれ以降の年（前項までの合計が変わる）を再生成する。年の初レグでシートが新規作成される。UI に帳票タブは無い（設定タブにシート一覧の表示のみ）。書き込み API は `{ flight, refreshed: [sheetName...] }` を返す。
- 再生成コストを抑える設計: レイアウト（各月ブロックの開始行と行数）と `REPORT_DESIGN_VERSION` が前回（Script Properties `report_layout_<sheet>`）と同じなら **値の `setValues` 1 回だけ**（書式・罫線・結合・列幅は残っているので触らない）。変わったとき、または `force`（メニューの「年次帳票をすべて再生成」と `repairFlightsSheetFormats`）のときだけ `clear` → 書式 → 値 → `RangeList` でスタイル・罫線 → 結合・行高・列幅、の完全再構築。`getSettings_` は実行内キャッシュ（`apiSaveSettings` で無効化）。実測: 完全再構築 約 12 秒/年、値のみ 約 2〜3 秒/年（見込み）。
- 帳票デザインは Numbers 原本のスクリーンショットに合わせてある（`Report.gs` 冒頭コメント参照）: 細い格子 + 中太の外枠、ヘッダー下と合計行上の中太線、グループ境界（I, K, L, Q, U, W, Z, AB 列の左）の中太縦線、離陸|着陸 間の点線、1 行おきの薄い縞（合計行まで連続）、合計 3 行の左側 A..G を 1 セルに結合、ヘッダー「月日／＿＿年」「航空機／の型式」「自由欄／INST」、全セル中央揃え・通常ウェイト・Noto Sans JP 10pt、列幅は `REPORT_COL_WIDTHS`。Numbers の数式由来の `0:00` 埋めは再現しない。見た目を変えたら `REPORT_DESIGN_VERSION` を上げる。
- 重複判定キー（CSV 取込）: `date | dep_time | flight_no | registration`。
- 帳票に文字列らしき値（月日 `"5.30"`、時刻 `"23:40"`）を書くときは **`setNumberFormat('@')` を `setValues` より先に**呼ぶ。後から書式を付けても Sheets は書き込み時点で `5.3` に変換してしまう（実際に起きた不具合）。`dev/mock_gas.js` はこの自動変換を模擬するので、テストで検出できる。

### 編成と飛行時間の自動配分（UI `applyRole` + 共有ルール `src/CrewRules.html`）

根拠資料: JAL FLTOPS B777 ADM_Administration 26.29 (14 SEP 2026) 9-3「マルチまたはダブル編成時の飛行時間配分」飛行時間配分表 (Rev.2)。

- `CrewRules.html` が **唯一の配分表**（`CREW_PATTERNS`）と計算関数 `allocateCrew(patternId, member, block, xc, night)` を持つ。プレーン JS を `<script>` で包んであり、UI は `include('CrewRules')` で読み込み、サーバーは `Crew.gs` の `loadCrewRules_()`（`new Function`）で同じコードを評価する。テストは `tools/test_logic.js` で資料の例（8:19 の CA DUTY → 機長 4:10 + 副操縦士 1:23 = 飛行時間 5:33）を検証。
- パターン: 通常 N1〜N3（2 名、全時間を自分の DUTY へ）、マルチ M1〜M11（3 名）、ダブル D1〜D8（4 名）。D7 = CA/CA/CA/PUS（CA: 1/3CA + 1/6CO、PUS: 1/2PUS）、D8 = CA/CA/CO/PUS（全員 1/2）は 2 枚目のスクリーンショット（2026-09-21 追加）から収録。編成切替時の既定パターンは `CREW_DEFAULT_PATTERN`（通常 N1: CA/CO、マルチ M2: CA/CA/CO、ダブル D3: CA/CA/CO/CO）。
- 注意: 配分表の分数の合計はパターンにより 2 にならない（例 M6 は 7/3）。資料どおりに写してあるので「合計 = 2」のような検算をテストに入れないこと。
- 計算規則: 各項（分数 × ブロックタイム）を **項ごとに四捨五入**し、**飛行時間 (8 項) はその合計**（ブロックタイムの 2/3 等ではない）。野外・夜間も同じ分数。DUTY → 列: CA/CKC/RAL → 機長 (9)、SIC → 単独・副機長 (10)、PUS → 機長見習 (11)、CO → 副操縦士 (14)。野外・夜間は CA/CKC/RAL/SIC/PUS が機長側 (12/13)、CO が副操縦士側 (16/17)。
- UI: 「編成」= 通常 / マルチ / ダブル / 手動分割 / SIM。マルチ・ダブルは「パターン」と「自分（何番目・DUTY・計算式）」を選ぶ。入力 `_actual` = OUT→IN のブロックタイム（自動計算）、`_night` = 実夜間時間、`_xc` = 野外の有無。`block`（8 項）は計算結果で、詳細欄で手動上書き可。
- QPR: 入力フォームの「QPR フライト」チェック → `qpr` 列。**QPR は ROUTE CHK として記録する**（ユーザー指示）。`Qual.gs` の `qprDates_` が ROUTE CHK 列（設定 `dates_route` と飛行内容 `ROUTE…` に合流）に流れ、前回実施日・年度別実施日・基準月（`base_route` 未設定時）を埋める。様式外の追加ブロックは作らない（一度 29〜36 行に作ったが撤去、`QUAL_DESIGN_VERSION` = 3 で再レイアウトして消す）。
- 保存時に `crew` 列へ編成コード（`M2/0` = パターン / 自分の位置、`SPLIT`、`SIM`）を記録し、編集時に選択を復元する。**編集時は保存済みの値を再計算しない**（旧ルールで記録した過去レグを壊さないため）。編成や時刻を変えたときだけ再計算。
- 編集時の「実時間」入力（`_night`, 時刻が無いときの `_actual`）は、保存値（配分後）を自分の分数の合計で割って逆算する（例: 夜間 2:00 + 0:40 を 2/3 で割って 4:00）。合計をそのまま入れると再計算で二重配分になる（Chrome 実機テストで発見した不具合）。
- 旧データ（2024 年以前）は 3/4 + 1/4 など旧ルールで記録されている。Rev.2 は新規入力にのみ適用。

「JCAB 全項目を直接編集」を開けば任意の列を手動上書きできる。プリセットは補助であり、最終値は保存時のフォーム値。

### 入力の補助（Script.html）

- 便名 `flight_no` は UI（`change` で大文字化、CSS `text-transform`）とサーバー（`normalizeFlight_`）の両方で **大文字固定**。型式・登録記号・空港コードと同じ扱い。
- 時刻・時間の 3〜4 桁入力は `normClock()` が `change` 時に `H:MM` へ直す（`0745` → `07:45`、`130` → `1:30`。末尾 2 桁が 60 以上なら触らない）。サーバーの `parseClock_` も `0745` を受け付ける。他の `change` ハンドラより **先に登録**しておくこと（`applyRole` が正規化後の値を見る必要がある）。「JCAB 全項目を直接編集」の欄は `buildDetailGrid()` が後から作るので、そこで個別に同じリスナーを付ける（`bindForm` の一括登録には含まれない）。時間欄で桁だけの値を「分」として解釈する `toMin` の規則は変えていない（繰越合計の欄は対象外）。
- 必須チェックは `buildRecord()`（月日・型式・出発・到着、SIM 以外は登録記号、飛行時間 0 の拒否）。「今すぐ保存」と「キューに追加」の両方がここを通る。
- 編成「SIM」を選ぶと離陸・着陸欄（`.realcnt`）を隠して「SIM 離陸 / SIM 着陸」欄（`.simcnt`）を出す（`setRole`）。SIM 以外に切り替えると SIM 回数は 0 に戻し、`buildRecord()` も SIM 以外では 0 を送る。

### まとめて保存（未保存キュー、localStorage `logbook.pending`）

- 保存のたびに年次シートを更新するため 1 レグ 5〜8 秒かかる。その対策として、入力フォームの主ボタンは **「キューに追加」**（通信なし、`localStorage` に配列で保持、ページを閉じても残る）。「今すぐ保存」は従来どおり 1 レグを即書き込み。
- キューは「最近の記録」テーブルの先頭に **グレーの行（`tr.pending`、「未保存」タグ）** として表示し（`renderTable` の `opts.pending`、ボタンは `data-p`）、カード見出し横の「保存 (N 件)」「未保存を破棄」とヘッダーの「未保存 N」で扱う。別カードにはしない（ユーザー指示）。ボタン名は「保存」（即時）と「保存 (N 件)」（一括）。編集は `editPending(i)` → `editFlight(rec)` を再利用し、`S.pendingIdx` を持って「キューを更新」で置き換える。既存レグ（`id` あり）の編集もキューに入れられ、「既存レグの更新」タグが付く。
- 「まとめて保存」は `apiSaveFlights(items)`（Api.gs）を 1 回呼ぶ。サーバーは **全件を先に検証**（1 件でも不正なら何も書かず `N 件目: …` で失敗）、新規行は 1 回の `writeFlightRows_`、更新は行ごと、`upsertMasters_` と `refreshYearSheets_(最小の年)` を 1 回。戻り値 `{ flights, added, updated, refreshed }`。失敗時はキューをそのまま残す。
- 「復路を作成」はフォームが空（キュー追加直後）のとき、キューの最後のレグの出発/到着を使う。
- キューは端末ローカルで、スプレッドシートにもサーバーにも無い。別端末からは見えない。集計・一覧はキューを含まない。

### 資格要件（集計タブ、`apiQualification` in Totals.gs）

根拠資料: 資格要件チェックリスト 2026.06.21RVS。飛行日誌から導けるものだけ自動判定し、それ以外は設定の有効期限入力で警告する。

- 最終乗務日（block > 0 または着陸ありのレグ、SIM は除く）からの経過日数。連続 `QUAL_RETRAIN_DAYS`(60) 日以上で復帰訓練 → `over`、14 日前から `warn`。
- 直近 `QUAL_RECENCY_DAYS`(90) 日の離陸・着陸回数（各 3 回未満で `over`）。
- 訓練審査 M11/M12/M21/M22: 飛行内容がそのコードで始まるレグの最終日を前回実施日とし、次回基準月 = 前回 + 12 か月、実施期間 = 基準月 ±1 か月（`due`）、超過で `over`。M12 = 技能基準月、M21 = 基準月 + 6 か月という関係は表示のみ（それぞれ独立に前回 + 12 か月で判定）。
- 有効期限（Settings `exp_pe`, `exp_pea`, `exp_english`, `exp_competency`, `exp_passport`, `exp_visa`）: 残日数と警告閾値（PE/PEA 45 日、英語・特定操縦技能 90 日、パスポート/VISA 180 日 = `QUAL_EXPIRIES`）。これらの設定変更では年次シートは再生成しない。
- `apiQualification(today)` は `today` を省略可（テストでは固定日を渡す）。リスト型の期限（航空英語・特定操縦技能）は最新日付で判定。

### 資格要件チェックリスト シート（`Qual.gs`）

- 原本 `資格_要件チェックリスト_20260621.xlsx` の **CAP** シート A1:J27 をセル単位で再現（文字列・結合 B3:C3, D3:E3, C12:J15 各行, B17:J27 各行 + B19:J20, A19:A20・列幅・行高・灰色 #C0C0C0 の見出し・太線/細線・配置・フォントサイズ 12/11/10/8）。注意事項の全文は `QUAL_NOTES`。見た目を変えたら `QUAL_DESIGN_VERSION` を上げる。
- 記入内容（`qualSheetData_` → `planQualSheet_`）:
  - D1 所属／社員番号／氏名 = Settings `department` / `employee_no` / `pilot_name`。
  - 行 3 基準月: `base_skill`（空なら最後の M12 または CACK の月）→ CACK/M12、+6 か月 → M21/M22、`base_route`、`base_dit`（空なら最後の実施日の月）、PE/PEA は有効期限の月。
  - 行 5 前回実施日 = 各列の最新日付。行 6〜10 = 年度（4 月始まり）FY-1〜FY+3 の実施日（列 A に「2026年度／実施日」と年度を入れる）。H8:H10 は原本どおり「－」。
  - M12/M21/M22 = 飛行内容がそのコードで始まるレグの日付。CACK = 飛行内容 CACK/M11 + `dates_cack`。ROUTE CHK/DIT = 飛行内容 ROUTE/DIT + `dates_route`/`dates_dit`。63 歳付加訓練/PE/PEA 実施日 = `dates_age63`/`dates_pe`/`dates_pea`。PE/PEA セルは「有効期限 … / 実施日 …」の 2 行。
  - 行 12〜15 = `exp_english`（最大 2）、`exp_competency`（最大 5）、`exp_passport`、`exp_visa` を「(1) 2027 / 03 / 31」形式で。日付リストはカンマ区切り（`dateList_` が不正値を捨てる）。
  - 空欄は原本のプレースホルダ文字列（「        年       月       日」等）をそのまま出す。
- 更新タイミング: `refreshYearSheets_` の末尾（レグの追加・更新・削除・取込）と `apiSaveSettings`（すべての設定変更）。レイアウト済みなら値の `setValues` 1 回のみ（L1 に「更新 日付」）。メニュー「資格要件チェックリストを再生成」= `apiRebuildQualSheet()`（強制再構築）。
- 印刷設定（横・1 ページ収まり）は API で設定できないので手動。

### Flights シート直接編集の検査（`src/Validate.gs`）

- 単純トリガー `onEdit(e)`: 編集範囲が `Flights` のときだけ、列の `kind` に応じて値を検査し、問題のあるセルを赤（`FLIGHT_BAD_BG`）+ メモにする。正しい値に直すと消える。**値は書き換えない**、年次シート・チェックリストも触らない（次に UI から保存したときに反映）。
- 検出内容: Date / 日割り小数に化けた日付・時刻・テキスト、`YYYY-MM-DD` / `HH:MM` 以外の書式、分の列に `1:30` や小数、ICAO 4 文字以外、編成コード、`qpr` の値、型式・登録記号の小文字。
- 単純トリガーの制約: 認可が要るサービス（Properties / Utilities / Lock）は使わない、1 回 200 行まで。全件検査はメニュー「Flights シートを検査」（`validateFlightsSheet`）。
- `dev/mock_gas.js` は `setBackgrounds` / `setNotes` をセルごとに記録し、`tools/test_logic.js` が `onEdit({ range })` を直接呼んで検証する。

### UI の表記規則

- 画面上では副操縦士を **CO** と表記する（`SIC` は使わない）。列ラベルはサーバーの `FLIGHT_COLUMNS.label`（JCAB 正式名、`SOLO or SIC` を含む）を `lbl(k)` で `SIC → CO` に置換して表示する。帳票シートのヘッダー（`REPORT_HEADER_*`）は JCAB 様式どおり `SIC` のまま。
- ラベルは必ず 1 行（`white-space: nowrap`、はみ出しは省略記号）。「JCAB 全項目」「繰越合計」グリッドは列幅 160px 以上・ラベル 10px で `単独・副機長 (SOLO or CO)` が折り返さない。

## 4. 開発ワークフロー

```bash
# 1. 旧データを書き出す（numbers-parser が必要）
pip install numbers-parser
python tools/export_numbers.py "FLIGHT LOGBOOK.numbers"

# 2. サーバーロジックの回帰テスト（Apps Script 不要）
node tools/test_logic.js        # ALL PASSED が出ること。期待値は「初回 Numbers (860 レグ, 〜2024-10)」の合計行に固定
#   → data/flights_test.csv / data/carry_forward_test.json（git 管理外の固定フィクスチャ）を使う。無ければ次で再生成:
python tools/export_numbers.py "../FLIGHT LOGBOOK.numbers" --tag test
#   運用データ (data/flights.csv) は "../FLIGHT LOGBOOK 2.numbers" 以降の最新エクスポートで、テストには使わない

# 3. UI をローカルで動かす（google.script.run をモックに差し替え、CSV を自動投入）
python dev/serve.py 8765        # → http://localhost:8765/        HtmlService 版
node dev/api_server.js 8766     # → http://localhost:8765/docs/   Pages 版（build_pages.py --api-url http://localhost:8766/api でビルドし、パスワード dev-pass）

# 4. Pages 版を再生成（src/ を変えたら必ず）
python tools/build_pages.py
```

- `.gs` は V8 ランタイムの JavaScript。構文確認は `node tools/test_logic.js`（vm で全ファイルを読み込む。Node 24 の `node --check` は拡張子 `.gs` を拒否する）。Apps Script API は `dev/mock_gas.js` に無いものを使ったらモックにも追加する。
- サーバー関数は **`api` 接頭辞 = UI 公開**、末尾 `_` = 非公開（Apps Script の慣例で `google.script.run` から呼べない）。
- Apps Script エディタの「実行」ボタンは引数を渡せない。引数を取る `api*` 関数には、必要に応じて引数なしのラッパー（例: `importCarryForwardFromDrive`）かメニュー用のプロンプト版（例: `importCarryForwardPrompt`）を用意する。新しい GAS サービス（DriveApp 等）を使ったら `dev/mock_gas.js` にも模擬を追加する。
- `src/*.gs` の読み込み順は Apps Script 上では無関係だが、`test_logic.js` と `serve.py` では `Schema → Util → Api → Totals → Report → Import → Code` の順。グローバル定数は Schema.gs にまとめる。
- UI とサーバーの契約は JSON のみ（Date オブジェクトを返さない）。

### Apps Script へのデプロイ（clasp 運用、2026-09-25 導入）

**新しいマシンで作業を始めたら、最初に clasp 環境を用意すること**（エージェントも同様。`.clasp.json` とログイン情報 `~/.clasprc.json` は git 管理外なので、クローンしただけでは push できない）:

1. Node.js が無ければ入れる（`winget install OpenJS.NodeJS.LTS`）。
2. `powershell -ExecutionPolicy Bypass -File tools\setup_clasp.ps1` を実行 — clasp v3 の導入、`.clasp.json.example` → `.clasp.json`、未ログインなら `clasp login`、最後に `clasp status`。`src/` の **15 ファイルすべてが Tracked** であることを必ず確認する。
3. `clasp login` の許可と「Google Apps Script API」のオン（https://script.google.com/home/usersettings、アカウントごとに 1 回）はブラウザでの利用者本人の操作。エージェントは代行しない（URL を示して待つ）。

- 対象: スプレッドシートに紐づいた（コンテナバインド）プロジェクト。scriptId `1tgx8rE5Od7sSl9AUSw11YbdtH00bSWBp3LbgFrsfd4pfPMlyPRe5e4vV`（`.clasp.json.example` に記載。秘密ではない）。アカウント `kiyonda69@gmail.com`。バインド型なので `clasp list` には出ない。
- 反映: `tools\clasp_deploy.ps1` = `clasp push --force` + Pages 用デプロイ（`pages.config.json` の `apiUrl` の ID）を新バージョンに更新（URL は不変）。`-PushOnly` で push のみ。push だけでスプレッドシート（メニュー・onEdit）と HtmlService 版は新コードになるが、**Pages 版の `/exec` は固定バージョンなのでデプロイ更新まで旧コード**。ロールバックは `clasp versions` → `clasp deploy -i <ID> -V <番号>`。
- `--force` が必要: clasp 3 は `appsscript.json` の上書きを対話で確認し、端末が無いと「Skipping push.」で何も送らない。
- `.claspignore` は **clasp 3 では `rootDir`（`src/`）からの相対パス**で解釈される（`!*.gs` / `!*.html` / `!appsscript.json`）。旧記述 `!src/**` のままだと何も一致せず、push でリモートの全ファイルが消える状態だった。変えたら必ず `clasp status` で 15 ファイルを確認。
- `src/appsscript.json` の `webapp.access` は **`ANYONE_ANONYMOUS`**（Pages 版の fetch に必須、本番と一致）。`MYSELF` に戻すと、次のデプロイで Pages 版が壊れる。
- push の前に、エディタで直接書き換えられていないかを見るなら、スクラッチに `clasp clone <scriptId>` して `src/` と比較する（改行差のみなら同一）。
- Claude デスクトップ（Windows, MSIX 版）の注意: アプリ内のシェルで実行した `npm install -g` は `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\npm` にリダイレクトされ、利用者のターミナルからは見えない（アプリ内からは `%APPDATA%\npm\clasp.cmd` で使える）。`~/.clasprc.json` は AppData 外なので共有される。また新規インストール直後のツールは、アプリやターミナルを再起動するまで PATH に載らない（`$env:Path` を Machine + User から読み直すか、フルパスで呼ぶ）。
- 手動: スプレッドシート → 拡張機能 → Apps Script に `src/` の各ファイルを同名で作成（`.gs` → スクリプト、`.html` → HTML）。
- 初回（新規スプレッドシート）: エディタから `setupSpreadsheet()` を実行 → 「デプロイ > 新しいデプロイ > ウェブアプリ（自分として実行）」。アクセスは HtmlService 版だけなら「自分のみ」、Pages 版を使うなら「全員」+ `setApiPasswordPrompt`。
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
- `onEdit`（Validate.gs）で値を書き換える・年次シートを再生成する。検出と赤表示だけに留める（単純トリガーは 30 秒制限と権限制限がある）。
- 年次シート `飛行日誌_YYYY` を手編集して正とする（次の保存で上書きされる）。
- 時間を小数時間（7.5h）で保存する。分単位のみ。
- `Settings` の `carry_forward_*` を無断で変える（累計がすべてずれる）。
- 実データ（登録記号・便名・氏名・技能証明番号）を外部サービスに送る。
- `clasp status` で `src/` の 15 ファイルが Tracked になっているのを確かめずに `clasp push` する（`.claspignore` の誤りでリモートの全ファイルが消える）。
- `src/appsscript.json` の `webapp.access` を `MYSELF` にする（Pages 版の API が使えなくなる）。

## 7. 今後の拡張候補（未実装）

- 年次シートの印刷設定（A4 横、ヘッダー繰り返し）の自動化。
- 年次シートの再生成を時間トリガーで非同期化（保存の応答時間が気になる場合）。
- 90 日 3 回離着陸などのカレンシー警告をヘッダーに表示（`apiRecency` は実装済み、閾値判定は未実装）。
- ICAO 空港マスターに IATA / 空港名を投入（`Airports` シートの `iata`, `name` は空）。
- 同乗教育 / 操縦教員時間の入力プリセット。
- Google Sheets 側からの本格的な入力支援（`onEdit` は検出と赤表示のみ実装済み。自動修復や年次シートの追従は未実装）。
