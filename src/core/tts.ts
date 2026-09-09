import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, Beat } from "./schema.ts";
import { hash, run, json, atomic } from "./util.ts";
import { SAMPLE_RATE } from "./timeline.ts";
export interface TTSProvider {
  version: string;
  extension?: string;
  validate?(
    settings: Project["settings"]["tts"],
    signal: AbortSignal,
  ): Promise<void>;
  synthesize(
    text: string,
    settings: Project["settings"]["tts"],
    file: string,
    signal: AbortSignal,
  ): Promise<void>;
}
export const macosSay: TTSProvider = {
  version: `macos-say-pcm-v1:${os.release()}`,
  async validate(settings, signal) {
    if (settings.provider !== "macos-say") throw Error("TTS設定が一致しません");
    if (process.platform !== "darwin") throw Error("macOSのsayが必要です");
    const output = await run("/usr/bin/say", ["-v", "?"], signal, 10000);
    const voices = output.split("\n").flatMap((line) => {
      const match = line.match(/^(.*?)\s{2,}ja_JP\s/);
      return match ? [match[1].trim()] : [];
    });
    if (!voices.includes(settings.voice))
      throw Error(
        `日本語の声が見つかりません: ${settings.voice}。say -v '?' で確認してください`,
      );
  },
  async synthesize(text, settings, file, signal) {
    if (settings.provider !== "macos-say") throw Error("TTS設定が一致しません");
    if (process.platform !== "darwin") throw Error("macOSのsayが必要です");
    const input = file + ".txt";
    await fs.writeFile(input, text);
    try {
      await run(
        "/usr/bin/say",
        [
          "-v",
          settings.voice,
          "-r",
          String(settings.rate),
          "-f",
          input,
          "-o",
          file,
        ],
        signal,
        90000,
      );
    } finally {
      await fs.rm(input, { force: true });
    }
  },
};
export const aquestalkPlayer: TTSProvider = {
  version: `aquestalk-player-wav-v1:${os.release()}`,
  extension: ".wav",
  async validate(settings, signal) {
    signal.throwIfAborted();
    if (settings.provider !== "aquestalk-player")
      throw Error("TTS設定が一致しません");
    if (process.platform !== "darwin")
      throw Error("Mac版AquesTalkPlayerが必要です");
    try {
      await fs.access(aquestalkPath(), fs.constants.X_OK);
    } catch {
      throw Error(
        "AquesTalkPlayerが見つかりません。公式Mac版をApplicationsへインストールするか、PROFESSORE_AQUESTALK_PLAYERに実行ファイルの絶対パスを設定してサービスを再起動してください",
      );
    }
  },
  async synthesize(text, settings, file, signal) {
    if (settings.provider !== "aquestalk-player")
      throw Error("TTS設定が一致しません");
    const input = file + ".txt";
    await fs.writeFile(input, text);
    try {
      await run(
        aquestalkPath(),
        ["-F", input, "-P", settings.preset, "-W", file],
        signal,
        90000,
      );
      if (!(await fs.stat(file)).size) throw Error("WAVが空です");
    } catch (e) {
      throw Error(
        `AquesTalkPlayerの音声生成に失敗しました。プリセット「${settings.preset}」が存在するか、アプリで読み上げできるか確認してください: ${(e as Error).message}`,
      );
    } finally {
      await fs.rm(input, { force: true });
    }
  },
};
function aquestalkPath() {
  return (
    process.env.PROFESSORE_AQUESTALK_PLAYER ||
    "/Applications/AquesTalkPlayer.app/Contents/MacOS/AquesTalkPlayer"
  );
}
export function ttsProvider(settings: Project["settings"]["tts"]): TTSProvider {
  return settings.provider === "aquestalk-player" ? aquestalkPlayer : macosSay;
}
export function speechText(b: Beat, p: Project) {
  if (b.speech) return b.speech;
  const dict = p.settings.pronunciations;
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  if (!keys.length) return b.narration;
  const pattern = keys
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return b.narration.replace(new RegExp(pattern, "g"), (v) => dict[v]);
}
export function audioKey(b: Beat, p: Project, version: string) {
  return hash({
    text: speechText(b, p),
    settings: p.settings.tts,
    dictionary: p.settings.pronunciations,
    version,
    sampleRate: SAMPLE_RATE,
  });
}
export async function generateAudio(
  b: Beat,
  p: Project,
  cache: string,
  signal: AbortSignal,
  provider: TTSProvider = ttsProvider(p.settings.tts),
) {
  signal.throwIfAborted();
  await provider.validate?.(p.settings.tts, signal);
  await fs.mkdir(cache, { recursive: true });
  const key = audioKey(b, p, provider.version),
    file = path.join(cache, key + ".pcm"),
    meta = file + ".json";
  try {
    const m = await json(meta),
      buf = await fs.readFile(file);
    if (
      m.samples > 0 &&
      buf.length === m.samples * 2 &&
      m.digest === hash(buf.toString("base64"))
    )
      return { key, file, samples: m.samples as number, cached: true };
  } catch {}
  const tmp = path.join(cache, randomUUID());
  const source = tmp + (provider.extension ?? ".aiff");
  try {
    let last: unknown;
    for (let retry = 0; retry < 2; retry++) {
      try {
        await fs.rm(source, { force: true });
        await provider.synthesize(
          speechText(b, p),
          p.settings.tts,
          source,
          signal,
        );
        await run(
          "ffmpeg",
          [
            "-y",
            "-v",
            "error",
            "-i",
            source,
            "-ar",
            String(SAMPLE_RATE),
            "-ac",
            "1",
            "-f",
            "s16le",
            tmp + ".pcm",
          ],
          signal,
        );
        const data = await fs.readFile(tmp + ".pcm");
        if (data.length < 960 || !data.some((v) => v !== 0))
          throw Error(
            "音声が空です。選択したTTSの音声・プリセット・音量を確認してください",
          );
        await fs.rename(tmp + ".pcm", file);
        await atomic(meta, {
          samples: data.length / 2,
          digest: hash(data.toString("base64")),
          provider: provider.version,
        });
        return { key, file, samples: data.length / 2, cached: false };
      } catch (e) {
        last = e;
        signal.throwIfAborted();
      }
    }
    throw last;
  } finally {
    await fs.rm(source, { force: true });
    await fs.rm(tmp + ".pcm", { force: true });
  }
}
