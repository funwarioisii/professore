# 設計メモ（2026-09-08）

## 採用構成

Bun（miseでバージョン固定）、TypeScript、React 19、Zod、Express、Mermaid 11、Playwright Chromium、FFmpeg、macOS `say`。JSON・アセット・生成物をローカル保存する。CLIとstdio MCPは、独立したローカルHTTPサービスへ同じ操作を依頼する。UIに処理を持たせず、サービスが唯一の書き込み主体になる。

Remotionは検討したが、今回のbeat境界の表示／強調と短いフェードには、共通Reactスライドを必要な状態だけスクリーンショットにし、FFmpegで連続フレーム化する構成を選択した。全フレームのブラウザ描画を避けられる。UIのiframeと動画生成は同じ `Slide` / `renderSlide` を使う。任意アニメーションや一般的な動画編集を追加する際は再検討する。

[Remotionのライセンス](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) は利用者・組織規模等による条件がある。今回は依存に含めない。React/Mermaid/Zod/Express/marked/DOMPurifyは各配布物のMIT系ライセンス、PlaywrightはApache-2.0、FFmpegはビルド構成依存（本機はGPL＋libx264）。FFmpegやシステム音声・フォントをこのリポジトリへ再配布しない。バイナリ製品として再配布する場合は依存ごとの条件を別途確認する。

## 公式APIの確認

- [Playwrightの対応OS・Node](https://playwright.dev/docs/intro#system-requirements)：macOS 14+、Node 22/24/26。`chromium.launch`、`page.screenshot` を利用。
- [Mermaid render API](https://mermaid.js.org/config/usage.html)：`initialize` と `render`。strictモード、HTMLラベル無効、生成SVGにもサニタイズを適用。ユーザー側設定ディレクティブを拒否。
- [FFmpeg CLI](https://ffmpeg.org/ffmpeg.html)：concat入力、fpsフィルター、raw PCM入力、H.264/AAC、faststart。ffprobeで実ファイルを再検証。
- [MCPサーバー](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server)：stdio transport、stdoutをプロトコル専用とする。実装は固定されたSDK 1.30.0のAPIを型検査とプロトコルE2Eで確認。
- macOS `say`：実機の `say -v '?'` と音声ファイル出力、`afinfo` で確認。

## 時間・キャッシュ・リビジョン

48kHz/mono/16bit PCMへ実音声をデコードする。音声長はファイルのサンプル数から求め、前後の間もサンプル単位で積算する。フレーム境界は累積サンプル位置からceilで求めるため、beatごとの丸め誤差を累積しない。後ろの間は最低0.1秒。全音声は一つのPCMへ配置し、最後に一度だけAACにするため、beat単位のAACエンコーダ遅延は入らない。

音声前の間からstartイベント、発話が終わった最初のフレームからendイベントを適用する。字幕は発話が始まるフレームから終わるフレームまで。イベントがない区間は一枚の画面を保持し、show/hideフェードだけ各フレームを描く。FFmpeg出力の総フレーム数が計算値と一致することを成功条件とする。

音声キーは読み上げ文、音声設定、発音辞書、OSを含むプロバイダーバージョン。視覚設定やイベントはキーに入れない。見た目の変更は常に新しい描画を行う。JSON Schemaによる構造検証に加え、ID重複、参照、SVG XMLの許可リストを検証する。

原稿全体を不変リビジョンとして保持し、expectedRevisionで競合を検出。意味レビューもその番号に紐付く。生成物は手書き原稿と分離。成功後だけ作業フォルダを確定領域へrenameする。再起動時のrunning/queuedジョブはinterruptedへ移す。復旧時は最初から再実行し、成功済み音声キャッシュを再利用する。

## 境界

自動の意味理解・事実判定は実装しない。ホストAIが出典、簡略化、矛盾、説明の順序をレビューする。UIの構造検証合格を内容の正しさとして表示しない。外部資料を自動取得せず、アセットの取り込みは明示的なCLI操作またはJSONの埋め込みで行う。

## Bun / miseへの移行（2026-09-09）

依存管理とTypeScript実行をBunに統一し、tsxを削除。既存依存の解決結果を `bun.lock` へ移行した。[Bunのロックファイル仕様](https://bun.sh/docs/pm/lockfile) に従い、CIではfrozen installを使う。開発・CIは同じ `mise.toml` のBun 1.3.14を使い、[miseのCI手順](https://mise.jdx.dev/continuous-integration.html) に沿って `mise exec` / `mise run` で実行する。
