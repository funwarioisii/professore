---
name: professore
description: Professoreで日本語の解説MP4を制作・改訂する。構造化原稿、意味レビュー、実音声、同期した図をローカルCLIまたはMCPで生成するときに使う。
---

# 解説MP4の制作

このリポジトリの [スキーマ](../../schema/project.schema.json) と [動作サンプル](../../examples/oauth.json) を読む。サービスは利用者が別ターミナルで `bun run start` を起動し、CLIとMCPの処理を引き受ける。MCPの接続終了はジョブを停止しない。Bunは `mise.toml` の固定バージョンを使い、シェルでmiseを有効化していない場合は `mise exec -- bun ...` で実行する。

## 原稿を作る

1. 対象読者、前提、理解目標、扱わない範囲、目標尺、出典を決める。通常の不足は妥当な仮定で進め、説明の内容・対象者を大きく変える曖昧さだけ質問する。
2. 3〜5シーン程度に分け、各シーンの役割、画面、ナレーションをセットで作る。秒数を推測して割り当てず、自然な数文をbeatにする。
3. 本文はMarkdown。図はMermaid全体か、安全なSVGアセット。IDは改訂でも維持する。表示・非表示中も同じ領域が確保されるので、要素数を増やしすぎない。
4. 全体を通して前提漏れ、論理の飛躍、重複、用語、図と台本の矛盾、根拠と簡略化、速度、シーン間のつながりを確認して原稿を修正する。レビュー結果は修正点と未解決事項だけを記録する。

短いbeatの例（`diagram` は同じシーン内の実在要素ID）：

```json
{"id":"request","narration":"アプリはブラウザを認可サーバーへ移動させます。","before":0.2,"after":0.5,"events":[{"target":"diagram","action":"highlight","at":"start","fade":0}]}
```

`settings.pronunciations: {"OAuth":"オーオース"}` で読みだけを変えられる。個別のbeatでは `speech` が優先される。字幕は `narration` を使う。SVGの対象は `elementId#svgId`、Mermaidは内部DOM IDを参照せず要素全体を対象にする。`show` / `hide` の `fade` は最大0.5秒。

## ツールで確定・生成する

MCPの基本手順：

- 新規：`save_project({project,expectedRevision:0})`
- 既存：`get_project({id})` → 原稿を修正 → `save_project({project,expectedRevision:取得した番号})`
- シーン変更：`update_scene({id,revision,sceneId,scene})`
- 構造確認：`validate_project({project})`
- 内容レビュー：`record_review({id,revision,reviewer:"host AI",fixes:[...],unresolved:[...]})`
- 音声確認：`start_job({projectId:id,revision,kind:"audio"})`
- 最終出力：`start_job({projectId:id,revision,kind:"render"})` → `get_job({id:jobId})`

CLIの場合（サービスは別ターミナル）：

```sh
bun run cli validate examples/oauth.json
bun run cli import examples/oauth.json
bun run cli review oauth examples/review.json
bun run cli render oauth
bun run cli wait JOB_ID
bun run cli download JOB_ID video.mp4 ./oauth.mp4
```

同梱レビューは同梱サンプル専用。新しい原稿へそのまま流用しない。

## 確認と改訂

`report.json` の構造・意味レビュー・render状態を区別する。構造検証だけで「内容が正しい」としない。代表静止画の見切れと日本語表示、実動画の段階表示、字幕と音声の同期、音声のつなぎ目を確認する。動画・原稿リビジョン・未検証事項を利用者に伝える。聴取できない環境では音質を確認済みとしない。

エラーにはシーン／beatのパスが付く。存在しないIDは参照を直し、SVG拒否は危険な要素を削除する。競合は最新リビジョンを取得して意図した変更だけを再適用する。フォント・音声エラーはREADMEの導入条件を確認し、ダミー音声で成功に見せない。失敗・キャンセルは `retry_job`、原稿を変えたら新リビジョンの `start_job` を使う。

視覚だけの修正は音声キャッシュを維持する。台本変更は変更beatの音声だけを再生成し、全体タイムラインを再計算する。成果物はサービスの `outputs/JOB_ID/`、取得URLは `/api/jobs/JOB_ID/artifacts/FILE`。利用者が単独再生できるMP4を渡して完了とする。
