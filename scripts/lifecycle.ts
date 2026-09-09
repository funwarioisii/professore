import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "professore-lifecycle-"));
const probe = net.createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as net.AddressInfo).port;
await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}/api`;
let child: ChildProcess | undefined;
const sleep = () => new Promise((r) => setTimeout(r, 100));
async function api(route: string, body?: unknown) {
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert(r.ok, JSON.stringify(d));
  return d;
}
async function start() {
  child = spawn(process.execPath, ["src/server.ts"], {
    env: {
      ...process.env,
      PROFESSORE_HOME: temp,
      PROFESSORE_PORT: String(port),
    },
    stdio: "ignore",
    detached: true,
  });
  for (let n = 0; n < 100; n++) {
    try {
      await api("/health");
      return;
    } catch {
      await sleep();
    }
  }
  throw Error("service startup timeout");
}
async function stop(signal: NodeJS.Signals) {
  if (!child?.pid) return;
  const exited = once(child, "exit");
  process.kill(-child.pid, signal);
  await exited;
  child = undefined;
}
async function wait(id: string, status: string) {
  for (let n = 0; n < 1200; n++) {
    const j = await api("/jobs/" + id);
    if (j.status === status) return j;
    if (["failed", "cancelled"].includes(j.status) && j.status !== status)
      throw Error(j.error);
    await sleep();
  }
  throw Error("job timeout");
}
try {
  await start();
  const p = JSON.parse(await fs.readFile("examples/oauth.json", "utf8"));
  p.id = "lifecycle";
  p.scenes = [p.scenes[0]];
  p.scenes[0].beats = [p.scenes[0].beats[0]];
  p.scenes[0].beats[0].narration = "再起動後も原稿と音声が残ります。";
  await api("/projects", { project: p, expectedRevision: 0 });
  const success = await wait(
    (await api("/jobs", { projectId: p.id, revision: 1, kind: "audio" })).id,
    "succeeded",
  );
  const frozen = await api("/jobs", {
    projectId: p.id,
    revision: 1,
    kind: "render",
  });
  await wait(frozen.id, "running");
  p.title = "編集中の新版";
  await api("/projects", { project: p, expectedRevision: 1 });
  await stop("SIGKILL");
  await start();
  assert.equal((await api("/jobs/" + frozen.id)).status, "interrupted");
  assert.equal((await api("/projects/" + p.id)).revision, 2);
  assert.equal((await api("/jobs/" + success.id)).status, "succeeded");
  const retry = await wait(
    (await api(`/jobs/${frozen.id}/retry`, {})).id,
    "succeeded",
  );
  assert.equal(retry.revision, 1);
  const r = await fetch(`${base}/jobs/${retry.id}/artifacts/project.json`);
  assert.equal((await r.json()).title, "OAuthの認可コードフロー");
  p.settings.tts = {
    provider: "macos-say",
    voice: "ProfessoreVoiceDoesNotExist",
    rate: 185,
  };
  await api("/projects", { project: p, expectedRevision: 2 });
  const failed = await wait(
    (await api("/jobs", { projectId: p.id, revision: 3, kind: "audio" })).id,
    "failed",
  );
  assert.match(failed.error, /beats/);
  await fs.writeFile(
    "docs/evidence/lifecycle.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        results: [
          "実音声の成功済み生成物をサービス再起動後も保持",
          "SIGKILL中のジョブは再起動後interrupted",
          "編集中の新版を混入せず、固定されたrevision 1で再実行",
          "存在しない声のTTS失敗はbeatの位置付きエラー",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Lifecycle and real TTS failure checks passed");
} finally {
  await stop("SIGTERM");
  await fs.rm(temp, { recursive: true, force: true });
}
