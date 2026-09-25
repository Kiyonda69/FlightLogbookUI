# CLAUDE.md

プロジェクトの指針は AGENT.md にまとめてある（下で取り込み）。作業前に必ず読むこと。

@AGENT.md

## 作業開始時のチェック（どのマシンでも）

- **clasp 環境**: `.clasp.json` が無い、または `%APPDATA%\npm\clasp.cmd` / `~/.clasprc.json` が無いマシンでは、最初に
  `powershell -ExecutionPolicy Bypass -File tools\setup_clasp.ps1` で clasp 環境を用意する（AGENT.md「Apps Script へのデプロイ」）。
  `clasp login` の許可と Apps Script API のオンは利用者本人のブラウザ操作なので、URL を示して待つ。
- `src/` を変えたら: `node tools/test_logic.js`（ALL PASSED）→ `python tools/build_pages.py` → コミット → `tools\clasp_deploy.ps1`（push + Pages 用デプロイ更新）。
