import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Project } from "../src/core/schema.ts";
import {
  audioKey,
  aquestalkPlayer,
  macosSay,
  ttsProvider,
} from "../src/core/tts.ts";

test("TTS selection preserves existing projects and isolates AquesTalk cache", async () => {
  const p = Project.parse(
    JSON.parse(await fs.readFile("examples/oauth.json", "utf8")),
  );
  const b = p.scenes[0].beats[0];
  assert.equal(ttsProvider(p.settings.tts), macosSay);
  const old = audioKey(b, p, "same-version");
  p.settings.tts = {
    provider: "aquestalk-player",
    preset: "デフォルト",
    cacheVersion: "1",
  };
  assert.equal(ttsProvider(p.settings.tts), aquestalkPlayer);
  assert(Project.safeParse(p).success);
  const key = audioKey(b, p, "same-version");
  assert.notEqual(old, key);
  p.settings.tts.preset = "自分の声";
  assert.notEqual(key, audioKey(b, p, "same-version"));
  p.settings.tts.preset = "デフォルト";
  p.settings.tts.cacheVersion = "2";
  assert.notEqual(key, audioKey(b, p, "same-version"));
  assert(
    !Project.safeParse({
      ...p,
      settings: { ...p.settings, tts: { ...p.settings.tts, rate: 100 } },
    }).success,
  );
  assert(
    !Project.safeParse({
      ...p,
      settings: {
        ...p.settings,
        tts: { provider: "aquestalk-player", preset: " " },
      },
    }).success,
  );
});

test("AquesTalk command passes Japanese text and preset literally, cleans up, and rejects missing WAV", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "professore-aq-test-"));
  const previous = process.env.PROFESSORE_AQUESTALK_PLAYER;
  const executable = path.join(dir, "test player");
  const output = path.join(dir, "test.wav");
  const settings = {
    provider: "aquestalk-player" as const,
    preset: '声 $(echo nope) "日本語"',
    cacheVersion: "1",
  };
  const text = "ゆっくりしていってね。\n認可コードを交換します。";
  try {
    await fs.writeFile(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); fs.writeFileSync(args[5] + '.args', JSON.stringify({args, text: fs.readFileSync(args[1], 'utf8')})); fs.writeFileSync(args[5], 'RIFF-test');\n`,
      { mode: 0o755 },
    );
    process.env.PROFESSORE_AQUESTALK_PLAYER = executable;
    await aquestalkPlayer.synthesize(
      text,
      settings,
      output,
      new AbortController().signal,
    );
    const captured = JSON.parse(await fs.readFile(output + ".args", "utf8"));
    assert.deepEqual(captured.args, [
      "-F",
      output + ".txt",
      "-P",
      settings.preset,
      "-W",
      output,
    ]);
    assert.equal(captured.text, text);
    await assert.rejects(fs.access(output + ".txt"));
    await fs.rm(output);
    await fs.writeFile(
      executable,
      `#!${process.execPath}\nprocess.exit(0);\n`,
      { mode: 0o755 },
    );
    await assert.rejects(
      aquestalkPlayer.synthesize(
        text,
        settings,
        output,
        new AbortController().signal,
      ),
      /プリセット/,
    );
    await assert.rejects(fs.access(output + ".txt"));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      aquestalkPlayer.synthesize(text, settings, output, controller.signal),
    );
    await assert.rejects(fs.access(output + ".txt"));
    process.env.PROFESSORE_AQUESTALK_PLAYER = path.join(dir, "missing");
    await assert.rejects(
      aquestalkPlayer.validate!(settings, new AbortController().signal),
      /AquesTalkPlayer/,
    );
  } finally {
    if (previous === undefined) delete process.env.PROFESSORE_AQUESTALK_PLAYER;
    else process.env.PROFESSORE_AQUESTALK_PLAYER = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
