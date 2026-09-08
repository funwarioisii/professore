import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, Beat } from "./schema.ts";
import { hash, run, json, atomic } from "./util.ts";
import { SAMPLE_RATE } from "./timeline.ts";
export interface TTSProvider {
  version: string;
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
  provider: TTSProvider = macosSay,
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
  try {
    let last: unknown;
    for (let retry = 0; retry < 2; retry++) {
      try {
        await provider.synthesize(
          speechText(b, p),
          p.settings.tts,
          tmp + ".aiff",
          signal,
        );
        await run(
          "ffmpeg",
          [
            "-y",
            "-v",
            "error",
            "-i",
            tmp + ".aiff",
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
            "音声が空です。macOSの音声ダウンロード・音声サービス権限を確認してください",
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
    await fs.rm(tmp + ".aiff", { force: true });
    await fs.rm(tmp + ".pcm", { force: true });
  }
}
