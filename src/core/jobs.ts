import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { pipeline, type Stage } from "./render.ts";
export type Job = {
  id: string;
  projectId: string;
  revision: number;
  kind: Stage;
  status:
    "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  phase: string;
  done: number;
  total: number;
  createdAt: string;
  error?: string;
  artifacts: string[];
};
export class Jobs {
  private controllers = new Map<string, AbortController>();
  private active = false;
  private queue: string[] = [];
  constructor(public store: Store) {
    for (const j of this.list())
      if (j.status === "running" || j.status === "queued") {
        j.status = "interrupted";
        j.error = "サービスが終了しました。retryで再実行できます";
        this.save(j);
      }
  }
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw Object.assign(Error("ジョブIDが不正です"), { status: 400 });
    return path.join(this.store.root, "jobs", id + ".json");
  }
  get(id: string): Job {
    return this.store.read(this.file(id));
  }
  list(): Job[] {
    return fs
      .readdirSync(path.join(this.store.root, "jobs"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.store.read(path.join(this.store.root, "jobs", f)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  save(j: Job) {
    this.store.write(this.file(j.id), j);
  }
  start(projectId: string, revision: number, kind: Stage) {
    this.store.get(projectId, revision);
    const job: Job = {
      id: randomUUID(),
      projectId,
      revision,
      kind,
      status: "queued",
      phase: "待機中",
      done: 0,
      total: 1,
      createdAt: new Date().toISOString(),
      artifacts: [],
    };
    this.save(job);
    this.queue.push(job.id);
    setImmediate(() => void this.drain());
    return job;
  }
  cancel(id: string) {
    const job = this.get(id);
    if (job.status === "queued" || job.status === "running") {
      job.status = "cancelled";
      job.phase = "キャンセル";
      this.save(job);
      this.controllers.get(id)?.abort();
    }
    return job;
  }
  retry(id: string) {
    const j = this.get(id);
    if (j.status === "running" || j.status === "queued")
      throw Object.assign(Error("実行中です"), { status: 409 });
    return this.start(j.projectId, j.revision, j.kind);
  }
  artifact(id: string, file: string) {
    const j = this.get(id);
    if (
      j.status !== "succeeded" ||
      !j.artifacts.includes(file) ||
      path.basename(file) !== file
    )
      throw Object.assign(Error("確定済み成果物がありません"), { status: 404 });
    return path.join(this.store.root, "outputs", id, file);
  }
  private async drain() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!,
          job = this.get(id);
        if (job.status === "cancelled") continue;
        const controller = new AbortController();
        this.controllers.set(id, controller);
        job.status = "running";
        this.save(job);
        const work = path.join(this.store.root, "work", id),
          out = path.join(this.store.root, "outputs", id);
        try {
          const record = this.store.get(job.projectId, job.revision);
          await pipeline(
            record.project,
            job.revision,
            work,
            path.join(this.store.root, "cache"),
            job.kind,
            controller.signal,
            (phase, done, total) => {
              Object.assign(job, { phase, done, total });
              this.save(job);
            },
            this.store.getReview(job.projectId, job.revision),
          );
          controller.signal.throwIfAborted();
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.renameSync(work, out);
          job.status = "succeeded";
          job.phase = "完了";
          job.done = job.total;
          job.artifacts = fs
            .readdirSync(out)
            .filter((f) => !f.endsWith(".ffconcat"));
          this.save(job);
        } catch (e) {
          job.status = controller.signal.aborted ? "cancelled" : "failed";
          job.error = (e as Error).message;
          this.save(job);
          fs.rmSync(work, { recursive: true, force: true });
        } finally {
          this.controllers.delete(id);
        }
      }
    } finally {
      this.active = false;
    }
  }
  shutdown() {
    for (const c of this.controllers.values()) c.abort();
  }
}
