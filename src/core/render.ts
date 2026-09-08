import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Project } from "./schema.ts";
import { timeline, type AudioEntry, type Timeline } from "./timeline.ts";
import { generateAudio, macosSay } from "./tts.ts";
import { atomic, run } from "./util.ts";
import { validate } from "./validate.ts";
const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
export type Stage = "audio" | "preview" | "render";
export async function pipeline(
  p: Project,
  revision: number,
  dir: string,
  cache: string,
  kind: Stage,
  signal: AbortSignal,
  progress: (phase: string, done: number, total: number) => void,
  review: unknown,
) {
  const check = validate(p);
  if (check.errors.length) throw Error(JSON.stringify(check.errors));
  await fs.mkdir(dir, { recursive: true });
  await atomic(path.join(dir, "project.json"), p);
  const audio: AudioEntry[] = [];
  const count = p.scenes.reduce((n, s) => n + s.beats.length, 0);
  for (const s of p.scenes)
    for (const b of s.beats) {
      signal.throwIfAborted();
      progress("日本語音声", audio.length, count);
      try {
        const a = await generateAudio(b, p, cache, signal);
        const file = `audio-${b.id}.pcm`;
        await fs.copyFile(a.file, path.join(dir, file));
        audio.push({ ...a, file, sceneId: s.id, beatId: b.id });
      } catch (e) {
        throw Error(`/scenes/${s.id}/beats/${b.id}: ${(e as Error).message}`);
      }
    }
  const timing = timeline(p, audio);
  const samples = Math.ceil((timing.totalFrames * 48000) / p.settings.fps);
  const mix = await fs.open(path.join(dir, "narration.pcm"), "w");
  try {
    await mix.truncate(samples * 2);
    for (const t of timing.beats) {
      signal.throwIfAborted();
      const data = await fs.readFile(path.join(dir, t.file));
      await mix.write(data, 0, data.length, t.speechStartSample * 2);
    }
  } finally {
    await mix.close();
  }
  await run(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      path.join(dir, "narration.pcm"),
      path.join(dir, "narration.wav"),
    ],
    signal,
  );
  for (const a of timing.beats) {
    const wav = a.file.replace(/\.pcm$/, ".wav");
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-i",
        path.join(dir, a.file),
        path.join(dir, wav),
      ],
      signal,
    );
    a.file = wav;
  }
  await atomic(path.join(dir, "generated.json"), {
    revision,
    provider: macosSay.version,
    settings: p.settings,
    timeline: timing,
    createdAt: new Date().toISOString(),
  });
  const report = {
    revision,
    structure: "passed",
    semanticReview: review ?? null,
    warnings: check.warnings as { path: string; message: string }[],
    audio: {
      beats: audio.length,
      cached: audio.filter((a) => a.cached).length,
    },
    frames: timing.totalFrames,
    duration: timing.totalFrames / p.settings.fps,
    render: "not-requested",
    manualPlayback: "not-verified",
  };
  if (kind !== "audio")
    await renderFrames(p, timing, dir, signal, progress, report.warnings);
  if (kind === "render") {
    progress("MP4エンコード", 0, 1);
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        path.join(dir, "frames.ffconcat"),
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-i",
        path.join(dir, "narration.pcm"),
        "-vf",
        `fps=${p.settings.fps}`,
        "-t",
        String(timing.totalFrames / p.settings.fps),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        path.join(dir, "video.mp4"),
      ],
      signal,
      1200000,
    );
    const probe = JSON.parse(
      await run(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path.join(dir, "video.mp4"),
        ],
        signal,
      ),
    );
    const v = probe.streams.find((s: any) => s.codec_type === "video"),
      a = probe.streams.find((s: any) => s.codec_type === "audio");
    if (
      v?.codec_name !== "h264" ||
      v?.pix_fmt !== "yuv420p" ||
      Number(v?.nb_read_frames) !== timing.totalFrames ||
      a?.codec_name !== "aac"
    )
      throw Error("MP4出力の形式・フレーム数検証に失敗しました");
    await atomic(path.join(dir, "ffprobe.json"), probe);
    report.render = "passed";
  }
  await atomic(path.join(dir, "report.json"), report);
  await fs.rm(path.join(dir, "narration.pcm"), { force: true });
  for (const a of audio) await fs.rm(path.join(dir, a.file), { force: true });
  return { report, timing };
}
export function boundaries(p: Project, t: Timeline) {
  const frames = new Set([0, t.totalFrames]);
  for (const beat of t.beats) {
    frames.add(beat.startFrame);
    frames.add(beat.endFrame);
    frames.add(Math.floor((beat.speechStartSample * t.fps) / 48000));
    frames.add(Math.ceil((beat.speechEndSample * t.fps) / 48000));
    const b = p.scenes
      .flatMap((s) => s.beats)
      .find((b) => b.id === beat.beatId)!;
    for (const e of b.events) {
      const at =
        e.at === "start"
          ? beat.startFrame
          : Math.ceil((beat.speechEndSample * t.fps) / 48000);
      for (let i = 0; i <= Math.ceil(e.fade * t.fps); i++)
        frames.add(Math.min(beat.endFrame, at + i));
    }
  }
  return [...frames]
    .filter((f) => f >= 0 && f <= t.totalFrames)
    .sort((a, b) => a - b);
}
async function renderFrames(
  p: Project,
  t: Timeline,
  dir: string,
  signal: AbortSignal,
  progress: (s: string, d: number, n: number) => void,
  warnings: { path: string; message: string }[],
) {
  const browser = await chromium.launch({ headless: true });
  const abort = () => {
    void browser.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const page = await browser.newPage({
      viewport: { width: p.settings.width, height: p.settings.height },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", (r) => r.abort());
    await page.setContent(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><div id="root"></div></html>',
    );
    await page.addStyleTag({
      content: await fs.readFile(path.join(dist, "slide.css"), "utf8"),
    });
    await page.addScriptTag({
      content: await fs.readFile(path.join(dist, "slide.js"), "utf8"),
    });
    const points = boundaries(p, t),
      lines = ["ffconcat version 1.0"];
    const screenshots: unknown[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      signal.throwIfAborted();
      progress("スライド描画", i, points.length - 1);
      const frame = points[i];
      const overflow = await page.evaluate(
        async (payload) => {
          return (window as any).renderSlide(payload);
        },
        { project: p, timeline: t, frame },
      );
      for (const el of overflow) {
        const item = {
          path: `frame/${frame}/${el}`,
          message: "描画領域のオーバーフロー",
        };
        if (!warnings.some((w) => w.path === item.path)) warnings.push(item);
      }
      const file = `frame-${String(i).padStart(5, "0")}.png`;
      await page.screenshot({ path: path.join(dir, file) });
      lines.push(
        `file '${file}'`,
        `duration ${((points[i + 1] - frame) / t.fps).toFixed(9)}`,
      );
      screenshots.push({ frame, file });
    }
    // A portable scene still summarizes the final beat, after its reveal transitions.
    for (const scene of p.scenes) {
      signal.throwIfAborted();
      const last = t.beats.find(
        (beat) => beat.beatId === scene.beats.at(-1)!.id,
      )!;
      const frame = Math.floor(
        ((last.speechStartSample + last.speechEndSample) * t.fps) / 96000,
      );
      await page.evaluate(
        async (payload) => (window as any).renderSlide(payload),
        { project: p, timeline: t, frame },
      );
      await page.screenshot({ path: path.join(dir, `scene-${scene.id}.png`) });
    }
    lines.push(
      `file 'frame-${String(points.length - 2).padStart(5, "0")}.png'`,
    );
    await fs.writeFile(
      path.join(dir, "frames.ffconcat"),
      lines.join("\n") + "\n",
    );
    await atomic(path.join(dir, "frames.json"), screenshots);
  } finally {
    signal.removeEventListener("abort", abort);
    await browser.close();
  }
}
