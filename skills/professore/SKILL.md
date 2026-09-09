---
name: professore
description: Professoreで日本語の解説MP4を制作・改訂する。構造化原稿、意味レビュー、実音声、同期した図をローカルCLIまたはMCPで生成するときに使う。
---

# 解説MP4の制作

この `SKILL.md` の実体パスを確認し、所属する `skills/professore` の2階層上をProfessoreのリポジトリとして扱う。ユーザースコープのシンボリックリンクから読んだ場合は `realpath` でリンク先を解決する。現在の作業フォルダをProfessoreのリポジトリと仮定しない。以下の相対リンクは実体のSkillディレクトリを基準に解決する。CLIはリポジトリへ移動して実行するか、`mise -C <Professoreの絶対パス> exec -- bun <Professoreの絶対パス>/src/cli.ts ...` を使う。

リポジトリの [スキーマ](../../schema/project.schema.json) と [動作サンプル](../../examples/oauth.json) を読む。サービスは利用者が別ターミナルで `bun run start` を起動し、CLIとMCPの処理を引き受ける。MCPの接続終了はジョブを停止しない。Bunは `mise.toml` の固定バージョンを使い、シェルでmiseを有効化していない場合は `mise exec -- bun ...` で実行する。

## 原稿を作る

1. 対象読者、前提、理解目標、扱わない範囲、目標尺、出典を決める。通常の不足は妥当な仮定で進め、説明の内容・対象者を大きく変える曖昧さだけ質問する。
2. 3〜5シーン程度に分け、台本を書く前に、各シーンの役割と「見せる関係・変化」「図の形式」「説明する順序」を設計する。この設計メモは作業用とし、スキーマにないフィールドは追加しない。
3. 仕組み・手順・因果関係・構造を説明するシーンは図を基本にする。図の流れに沿ってナレーションを作り、自然な数文をbeatにする。秒数を推測して割り当てない。画面の文章は見出し、短いラベル、要点に絞る。導入・定義・まとめなど、文字だけで理解しやすい場面はMarkdownでよい。利用者の指定を優先し、図の枚数や両形式の使用をノルマにしない。
4. 下の基準で図を実装し、beatの説明対象に表示・強調イベントを対応させる。IDは改訂でも維持する。表示・非表示中も同じ領域が確保されるので、要素数を増やしすぎない。
5. 全体を通して前提漏れ、論理の飛躍、重複、用語、図と台本の矛盾、根拠と簡略化、速度、シーン間のつながりを確認して原稿を修正する。説明シーンが箇条書きだけなら、関係や変化を図で示せないか再検討する。ナレーションを画面に並べただけになっていないか、図が理解目標に役立っているかも確認する。レビュー結果は修正点と未解決事項だけを記録する。

### 図の選び方

- Mermaid：手順、分岐、通信順序、依存関係など、標準的な図で関係を示すとき。`elements[]` の `kind: "mermaid"` と `content` に記述する。Markdown内のコードブロックには入れない。内部ノードごとの表示・強調には対応していないため、図全体を見せて説明する場面に使う。
- SVG：位置関係、独自の模式図、状態の比較、部品や矢印を順に見せるとき。`assets` に `type: "svg"` とSVG文字列の `data` を登録し、`kind: "asset"` の要素から `asset` IDで参照する。部品ごとに安定したIDを付け、`elementId#svgId` をbeatのイベント対象にする。話している箇所だけを強調・段階表示したい場合はこちらを優先する。

たとえば「ブラウザとサーバーの通信順序を俯瞰する」はMermaid、「認可コードがトークンに交換される各段階を指し示す」はSVGを選ぶ。図を置くだけで終わらず、登場人物・矢印・ラベルが何を意味するかを台本で説明する。要素が多い図は複数シーンに分け、各シーンの主図を読み取れる大きさに保つ。

短いbeatの例（`diagram` は同じシーン内の実在要素ID）：

```json
{"id":"request","narration":"アプリはブラウザを認可サーバーへ移動させます。","before":0.2,"after":0.5,"events":[{"target":"diagram","action":"highlight","at":"start","fade":0}]}
```

`settings.pronunciations: {"OAuth":"オーオース"}` で読みだけを変えられる。個別のbeatでは `speech` が優先される。字幕は `narration` を使う。SVGの対象は `elementId#svgId`、Mermaidは内部DOM IDを参照せず要素全体を対象にする。`show` / `hide` の `fade` は最大0.5秒。

ゆっくり音声を指定された場合は `settings.tts: {"provider":"aquestalk-player","preset":"デフォルト","cacheVersion":"1"}` を使う。AquesTalkPlayerのインストールと同名プリセットが必要。利用者が保存したプリセット名を指定できるが、「霊夢」などの名前が初期状態で存在すると仮定しない。声・速度はアプリ側で設定し、`voice` / `rate` を混ぜない。外部のプリセット・辞書・アプリ本体の変更後は `cacheVersion` を更新して再生成する。導入と切り替えは[README](../../README.md#ゆっくり音声aquestalkplayer)を参照する。音声生成に失敗しても、無断でmacOS標準音声へ置き換えない。

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

`report.json` の構造・意味レビュー・render状態を区別する。構造検証だけで「内容が正しい」としない。代表静止画の見切れと日本語表示、図のラベル・矢印の読みやすさ、実動画の段階表示と強調対象、字幕と音声の同期、音声のつなぎ目を確認する。SVG・Mermaidが実際に描画され、説明中に必要な部分が見えていることを確かめる。動画・原稿リビジョン・未検証事項を利用者に伝える。聴取できない環境では音質を確認済みとしない。

エラーにはシーン／beatのパスが付く。存在しないIDは参照を直し、SVG拒否は危険な要素を削除する。競合は最新リビジョンを取得して意図した変更だけを再適用する。フォント・音声エラーはREADMEの導入条件を確認し、ダミー音声で成功に見せない。失敗・キャンセルは `retry_job`、原稿を変えたら新リビジョンの `start_job` を使う。

視覚だけの修正は音声キャッシュを維持する。台本変更は変更beatの音声だけを再生成し、全体タイムラインを再計算する。成果物はサービスの `outputs/JOB_ID/`、取得URLは `/api/jobs/JOB_ID/artifacts/FILE`。利用者が単独再生できるMP4を渡して完了とする。
