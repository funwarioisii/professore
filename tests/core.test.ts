import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validate, requireProject, svgIds } from "../src/core/validate.ts";
import { Store } from "../src/core/store.ts";
import { timeline } from "../src/core/timeline.ts";
import { audioKey, speechText, generateAudio } from "../src/core/tts.ts";
import { Jobs } from "../src/core/jobs.ts";
const sample = () =>
  requireProject(JSON.parse(fs.readFileSync("examples/oauth.json", "utf8")));
test("sample validates; schema errors carry precise paths", () => {
  assert.deepEqual(validate(sample()).errors, []);
  const p: any = sample();
  p.schemaVersion = 2;
  p.scenes[0].beats[0].before = -1;
  const errors = validate(p).errors;
  assert(errors.some((e) => e.path === "/schemaVersion"));
  assert(errors.some((e) => e.path === "/scenes/0/beats/0/before"));
});
test("duplicate IDs, missing assets and nonexistent SVG targets fail", () => {
  const p = sample();
  p.scenes[0].beats[0].id = p.scenes[0].id;
  p.scenes[2].elements[0].asset = "missing";
  p.scenes[0].beats[0].events[0].target = "authorization#missing";
  const errors = validate(p).errors;
  assert(errors.some((e) => e.message.includes("重複")));
  assert(errors.some((e) => e.path.endsWith("/asset")));
  assert(errors.some((e) => e.path.endsWith("/target")));
});
test("SVG refuses executable content and external references", () => {
  for (const s of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    "<!DOCTYPE svg><svg/>",
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><rect fill="url(https://evil/x)"/></svg>',
    "<svg><style>@import url(x)</style></svg>",
  ])
    assert.throws(() => svgIds(s));
  assert(
    svgIds('<svg><g id="safe"><rect fill="url(#safe)"/></g></svg>').has("safe"),
  );
});
test("timeline uses cumulative samples without accumulating frame rounding", () => {
  const p = sample();
  p.scenes = [p.scenes[0]];
  p.scenes[0].beats = Array.from({ length: 100 }, (_, i) => ({
    ...p.scenes[0].beats[0],
    id: "b" + i,
    before: 0.123,
    after: 0.345,
    events: [],
  }));
  const audio = p.scenes[0].beats.map((b) => ({
    sceneId: p.scenes[0].id,
    beatId: b.id,
    file: "a",
    key: "a",
    samples: 48123,
    cached: false,
  }));
  const t = timeline(p, audio);
  assert.equal(t.totalFrames, Math.ceil((t.totalSamples * 30) / 48000));
  assert((t.totalFrames * 48000) / 30 - t.totalSamples < 1600);
  for (let i = 0; i < t.beats.length; i++) {
    const b = t.beats[i];
    assert(b.speechEndSample <= (b.endFrame * 48000) / 30);
    if (i) assert.equal(b.startFrame, t.beats[i - 1].endFrame);
  }
});
test("cache preserves audio for visuals and invalidates speech/settings/dictionary/provider", () => {
  const p = sample(),
    b = p.scenes[0].beats[0],
    key = audioKey(b, p, "v1");
  p.settings.theme = "paper";
  b.events = [];
  p.scenes[0].body = "changed";
  assert.equal(audioKey(b, p, "v1"), key);
  assert.notEqual(audioKey(b, p, "v2"), key);
  b.narration += "追記";
  assert.notEqual(audioKey(b, p, "v1"), key);
  const k = audioKey(b, p, "v1");
  p.settings.pronunciations.OAuth = "読み変更";
  assert.notEqual(audioKey(b, p, "v1"), k);
  const k2 = audioKey(b, p, "v1");
  assert(p.settings.tts.provider === "macos-say");
  p.settings.tts.rate++;
  assert.notEqual(audioKey(b, p, "v1"), k2);
});
test("pronunciation replacement is longest-first and nonrecursive; override wins", () => {
  const p = sample(),
    b = p.scenes[0].beats[0];
  p.settings.pronunciations = { OAuth: "API", API: "えーぴーあい" };
  b.narration = "OAuth API";
  assert.equal(speechText(b, p), "API えーぴーあい");
  b.speech = "オーバーライド";
  assert.equal(speechText(b, p), "オーバーライド");
});
test("revision conflicts, snapshots, review binding and traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "professore-test-"));
  try {
    const store = new Store(root),
      p = sample();
    store.save(p, 0);
    const old = store.get(p.id, 1);
    p.title = "new";
    store.save(p, 1);
    assert.throws(() => store.save(p, 1), /競合/);
    assert.equal(store.get(p.id, 1).project.title, old.project.title);
    store.review(p.id, {
      revision: 1,
      reviewer: "tester",
      fixes: [],
      unresolved: [],
    });
    assert.equal(store.getReview(p.id, 2), undefined);
    assert.throws(() => store.get("../x"));
    assert.throws(() => store.get(p.id, -1));
    const jobs = new Jobs(store);
    const j = jobs.start(p.id, 2, "audio");
    jobs.cancel(j.id);
    assert.equal(jobs.get(j.id).status, "cancelled");
    assert.throws(() => jobs.artifact(j.id, "video.mp4"));
    store.write(path.join(root, "jobs", j.id + ".json"), {
      ...j,
      status: "running",
    });
    const restarted = new Jobs(store);
    assert.equal(restarted.get(j.id).status, "interrupted");
  } finally {
    setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 20);
  }
});
test("TTS retries failures, reports error and observes cancellation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "professore-tts-"));
  try {
    const p = sample();
    let calls = 0;
    await assert.rejects(
      generateAudio(
        p.scenes[0].beats[0],
        p,
        root,
        new AbortController().signal,
        {
          version: "test-fail",
          async synthesize() {
            calls++;
            throw Error("voice missing");
          },
        },
      ),
      /voice missing/,
    );
    assert.equal(calls, 2);
    const controller = new AbortController();
    controller.abort();
    calls = 0;
    await assert.rejects(
      generateAudio(p.scenes[0].beats[0], p, root, controller.signal, {
        version: "test-abort",
        async synthesize() {
          calls++;
          controller.signal.throwIfAborted();
        },
      }),
    );
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("visual events follow time, preserve hidden space and fade deterministically", async () => {
  const { stateAt } = await import("../src/core/visual.ts");
  const p = sample(),
    s = p.scenes[0],
    b = s.beats[0];
  s.beats = [b];
  b.events = [
    { target: "roles", action: "hide", at: "end", fade: 0 },
    { target: "roles", action: "show", at: "start", fade: 0.2 },
  ];
  const t = timeline({ ...p, scenes: [s] }, [
    {
      sceneId: s.id,
      beatId: b.id,
      file: "a",
      key: "a",
      samples: 48000,
      cached: false,
    },
  ]);
  assert(
    stateAt(s, t, 0).roles.opacity > 0 && stateAt(s, t, 0).roles.opacity < 1,
  );
  assert.equal(stateAt(s, t, 10).roles.visible, true);
  assert.equal(
    stateAt(s, t, Math.ceil((t.beats[0].speechEndSample * 30) / 48000)).roles
      .visible,
    false,
  );
});
