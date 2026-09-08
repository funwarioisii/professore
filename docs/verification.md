# 検証結果

2026-09-08、macOS実機（Apple Silicon）、Node 26.0.0、FFmpeg 8.1.1、Chromium 151 / Playwright 1.62.1で検証しました。依存の詳細はpackage-lock.jsonに固定されています。

## 実音声・MP4

- macOSの日本語音声 `Kyoko` を `say -v '?'` で確認し、AIFFへ実出力。初回プローブは3.605941秒・79,511サンプル（22,050Hz）でした。
- 4シーン・8beatのOAuthサンプルをCLIから生成。最終出力は **133.000秒、3,990フレーム、1920×1080、30fps、H.264 / AAC、yuv420p**。
- サンプルの出典はRFC 6749 §4.1とRFC 9700 §2.1.1。意味レビューはrevision 1に保存。正常系・概念説明のための省略事項も記録しています。
- 日本語字幕、Markdownの本文・箇条書き・コード、Mermaid図、独立SVGの対象ID、beat境界の表示と強調を代表フレームで確認しました。
- 最終エンコード後にffprobeでcodec、音声トラック、解像度、フレーム数を確認し、ブラウザで実デコード、時間の進行、80秒へのシークを確認しました。
- 全beatについて、MP4からデコードした音声と元音声の波形相関・サンプル位置・終端までの長さを検査しました。[音声同期の証跡](evidence/audio-sync.json) を参照してください。

成果物は [サンプルMP4](../examples/output/video.mp4)、[生成メタデータ](../examples/output/generated.json)、[検証レポート](../examples/output/report.json)。出力フォルダにはシーン静止画・beat音声・固定原稿も含みます。

## 自動・プロトコル検証

- `npm test`：9件成功。位置付きスキーマエラー、ID・アセット参照、SVG安全性、100beatの累積丸め、音声キャッシュキー、発音置換、競合・履歴・レビュー、失敗再試行・キャンセル、イベントの時系列とフェードを検証。
- `npm run check`：TypeScript型検査成功。
- `npm run build`：ブラウザバンドル・JSON Schema生成成功。
- `npm run e2e`：MCP SDKのstdio Clientから検証・保存・意味レビュー・ジョブ開始。接続切断後もMP4生成完了。視覚変更は2/2音声を再利用、台本変更は1/2を再利用してタイムライン更新。競合409、キャンセル後の非公開、再実行、Origin/Host拒否を確認。[証跡](evidence/e2e.json)
- `npm run e2e:lifecycle`：別ポート・一時保存先で実サービスをSIGKILLし、再起動時のinterrupted状態と成功済み成果物の保持を確認。生成中の編集を混入させず元revisionで再実行。存在しない声はbeat位置付きの失敗。[証跡](evidence/lifecycle.json)
- `npm run e2e:ui`：JSON取り込み、構造検証、保存、beat台本編集、revision 2のJSON書き出し、Mermaidの日本語ラベル、動画の再生・シーク・保存リンクを検証。[証跡](evidence/ui.json)、[画面](evidence/ui.png)
- `skill-creator` の `quick_validate.py`：同梱Skillの構造検証成功。Skill記載のCLI操作を実行し、同じ流れをMCPプロトコルでも検証しました。

検証中に、MermaidのHTMLラベル設定、レイアウトのCSS衝突、隠し保存先からの成果物配信、無効なmacOS音声名の暗黙フォールバック、SVGの巻き戻し時の強調残りを修正しています。

## 残る制約・未検証事項

- **QuickTime Playerでの実再生と人による主観的な聴取品質は未検証**です。QuickTimeのUI操作ツールがタイムアウトしました。ブラウザ再生とAAC波形の客観検査は完了していますが、発音の自然さ、聞きやすさ、音声継ぎ目の主観評価とは区別しています。`open -a 'QuickTime Player' examples/output/video.mp4` で最終確認できます。
- 現在の本番TTSはmacOSの日本語音声のみ。クラウドTTS、別OSでの実音声生成、単語単位アライメントは未対応です。
- 字幕はbeat単位の焼き込み。表示／非表示の短いフェード以外の任意アニメーション、動画タイムラインのドラッグ編集、ネイティブ包装は未対応です。
- 原稿JSONの手動編集が中心です。UIはbeatの文章・読みの上書き・字幕を直接編集し、図・テーマ・辞書などはJSONで編集します。画面プレビューはレイアウト確認用で、実測音声の同期は生成後の動画で確認します。
- オーバーフロー検出はDOMの領域に対する警告です。SVG内部の極小文字や図の意味的な誤りまでは検出しません。Mermaid内部の任意ノードを段階表示する機能はありません。
- 同じ声の音声パッケージだけをOS版を変えず更新した場合は、必要に応じて `cache/` を削除してください。高度な途中フレーム再開・履歴削除UI・ディスク容量制限は未対応です。
- 特定のMCPクライアント製品の設定UIとQuickTimeは検証していません。検証済み接続はMCP SDK 1.30.0のstdioプロトコルです。GitHub Actionsのリモート実行結果はローカル検証とは別です。
