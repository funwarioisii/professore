import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { run } from "../src/core/util.ts";
const dir = path.resolve(process.argv[2]);
const generated = JSON.parse(
  await fs.readFile(path.join(dir, "generated.json"), "utf8"),
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "professore-audio-qa-"));
try {
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    path.join(dir, "video.mp4"),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "s16le",
    path.join(temp, "decoded.pcm"),
  ]);
  const decoded = await fs.readFile(path.join(temp, "decoded.pcm"));
  const rows = [];
  for (const beat of generated.timeline.beats) {
    const file = path.join(temp, "source.pcm");
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      path.join(dir, beat.file),
      "-f",
      "s16le",
      file,
    ]);
    const source = await fs.readFile(file);
    assert.equal(source.length / 2, beat.samples);
    let dot = 0,
      x2 = 0,
      y2 = 0;
    for (let i = 0; i < beat.samples; i++) {
      const x = source.readInt16LE(i * 2);
      const offset = (beat.speechStartSample + i) * 2;
      assert(offset + 2 <= decoded.length, "MP4音声が途中で切れています");
      const y = decoded.readInt16LE(offset);
      dot += x * y;
      x2 += x * x;
      y2 += y * y;
    }
    const correlation = dot / Math.sqrt(x2 * y2);
    assert(
      correlation > 0.9,
      `音声位置の相関が低い: ${beat.beatId} ${correlation}`,
    );
    rows.push({
      beatId: beat.beatId,
      samples: beat.samples,
      startSample: beat.speechStartSample,
      correlation,
    });
  }
  await fs.writeFile(
    "docs/evidence/audio-sync.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sampleRate: 48000,
        decodedSamples: decoded.length / 2,
        results: rows,
        subjectiveListening: "not-verified",
      },
      null,
      2,
    ),
  );
  console.log("AACからデコードした全8beatの音声位置・完全長・波形相関を確認");
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
