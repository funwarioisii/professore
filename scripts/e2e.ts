import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { api, base } from "../src/client.ts";
const id = "e2e" + Date.now();
const sample = JSON.parse(await fs.readFile("examples/oauth.json", "utf8"));
sample.id = id;
sample.title = "E2E 動作検証";
sample.settings.pronunciations["検証識別子"] = id;
sample.scenes = [sample.scenes[0]];
sample.scenes[0].beats = sample.scenes[0].beats.map((b: any, i: number) => ({
  ...b,
  narration: i
    ? "次に、変更した部分だけを読み上げます。"
    : "こんにちは。これは実際の日本語音声です。",
  events: [],
}));
const client = new Client({ name: "professore-e2e-host", version: "1.0.0" });
const connect = async () =>
  client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/mcp.ts"],
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      stderr: "pipe",
    }),
  );
await connect();
async function call(name: string, args: any) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  return JSON.parse((result.content as any[])[0].text);
}
async function wait(job: any) {
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    job = await api("/jobs/" + job.id);
    if (!["queued", "running"].includes(job.status)) {
      assert.equal(job.status, "succeeded", job.error);
      return job;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("E2E timeout");
}
async function artifact(job: any, name: string) {
  return (await fetch(`${base}/api/jobs/${job.id}/artifacts/${name}`)).json();
}
const results: string[] = [];
try {
  const tools = await client.listTools();
  assert(tools.tools.some((t) => t.name === "update_scene"));
  const v = await call("validate_project", { project: sample });
  assert.equal(v.errors.length, 0);
  const saved = await call("save_project", {
    project: sample,
    expectedRevision: 0,
  });
  assert.equal(saved.revision, 1);
  await call("record_review", {
    id,
    revision: 1,
    reviewer: "E2E host",
    fixes: [],
    unresolved: ["音声品質の主観評価は別途必要"],
  });
  const started = await call("start_job", {
    projectId: id,
    revision: 1,
    kind: "render",
  });
  await client.close();
  const first = await wait(started);
  results.push("MCP切断後も実音声付きMP4生成が完了");
  const report1 = await artifact(first, "report.json");
  assert.equal(report1.audio.cached, 0);
  assert.equal(report1.render, "passed");
  const current = await api("/projects/" + id);
  current.project.scenes[0].body = "## 見た目だけ変更";
  await api("/projects", { project: current.project, expectedRevision: 1 });
  const visual = await wait(
    await api("/jobs", { projectId: id, revision: 2, kind: "render" }),
  );
  assert.equal((await artifact(visual, "report.json")).audio.cached, 2);
  results.push("見た目だけの修正は2/2音声キャッシュを再利用して再描画");
  current.project.scenes[0].beats[1].narration =
    "台本を修正しました。変更していない音声は再利用します。";
  await api("/projects", { project: current.project, expectedRevision: 2 });
  const changed = await wait(
    await api("/jobs", { projectId: id, revision: 3, kind: "render" }),
  );
  assert.equal((await artifact(changed, "report.json")).audio.cached, 1);
  const timing1 = await artifact(visual, "generated.json"),
    timing2 = await artifact(changed, "generated.json");
  assert.notEqual(timing1.timeline.totalSamples, timing2.timeline.totalSamples);
  results.push("台本変更は1/2音声を再生成し、実測タイムラインと動画が更新");
  await assert.rejects(
    api("/projects", { project: current.project, expectedRevision: 1 }),
    /競合/,
  );
  results.push("古いリビジョンの更新を409で拒否");
  const bad = structuredClone(current.project);
  bad.scenes[0].beats[0].events = [
    { target: "missing", action: "show", at: "start", fade: 0 },
  ];
  assert((await api("/validate", bad)).errors.length);
  const cancel = await api("/jobs", {
    projectId: id,
    revision: 3,
    kind: "render",
  });
  await api(`/jobs/${cancel.id}/cancel`, {});
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal((await api("/jobs/" + cancel.id)).status, "cancelled");
  const hidden = await fetch(
    `${base}/api/jobs/${cancel.id}/artifacts/video.mp4`,
  );
  assert.equal(hidden.status, 404);
  results.push("キャンセル後は完成MP4を公開しない");
  const retry = await wait(await api(`/jobs/${cancel.id}/retry`, {}));
  assert.equal(retry.revision, 3);
  results.push("キャンセル後の再実行に成功");
  const evil = await fetch(base + "/api/projects", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(evil.status, 403);
  const hostStatus = await new Promise<number>((resolve) => {
    http.get(
      base + "/api/projects",
      { headers: { Host: "evil.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
  });
  assert.equal(hostStatus, 403);
  results.push("外部Origin・不正Hostを拒否");
  await fs.mkdir("docs/evidence", { recursive: true });
  await fs.writeFile(
    "docs/evidence/e2e.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        projectId: id,
        results,
        first: first.id,
        visual: visual.id,
        changed: changed.id,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client.close();
}
