import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "./util.ts";
import { requireProject } from "./validate.ts";
import { Id, type Project } from "./schema.ts";
export type RecordFile = { revision: number; digest: string; project: Project };
export type Review = {
  revision: number;
  reviewer: string;
  fixes: string[];
  unresolved: string[];
  createdAt: string;
};
export class Store {
  constructor(public root: string) {
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    fs.mkdirSync(path.join(root, "jobs"), { recursive: true });
  }
  safeId(id: string) {
    return Id.parse(id);
  }
  dir(id: string) {
    return path.join(this.root, "projects", this.safeId(id));
  }
  write(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + randomUUID() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  read(file: string) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw Object.assign(Error("見つかりません"), { status: 404 });
      throw e;
    }
  }
  list() {
    return fs
      .readdirSync(path.join(this.root, "projects"))
      .filter((id) => fs.existsSync(path.join(this.dir(id), "current.json")))
      .map((id) => {
        const p = this.get(id);
        return { id, title: p.project.title, revision: p.revision };
      });
  }
  get(id: string, revision?: number): RecordFile {
    if (
      revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1)
    )
      throw Object.assign(Error("revisionが不正です"), { status: 400 });
    return this.read(
      path.join(
        this.dir(id),
        revision ? `revisions/${revision}.json` : "current.json",
      ),
    );
  }
  save(input: unknown, expectedRevision: number): RecordFile {
    const project = requireProject(input),
      dir = this.dir(project.id);
    let current: RecordFile | undefined;
    try {
      current = this.get(project.id);
    } catch (e) {
      if ((e as any).status !== 404) throw e;
    }
    if ((current?.revision ?? 0) !== expectedRevision)
      throw Object.assign(
        Error("リビジョンが競合しました。最新原稿を読み直してください"),
        { status: 409 },
      );
    const revision = (current?.revision ?? 0) + 1,
      record = { revision, digest: hash(project), project };
    this.write(path.join(dir, `revisions/${revision}.json`), record);
    this.write(path.join(dir, "current.json"), record);
    return record;
  }
  updateScene(id: string, revision: number, sceneId: string, scene: unknown) {
    const current = this.get(id);
    if (current.revision !== revision)
      throw Object.assign(Error("リビジョンが競合しました"), { status: 409 });
    const index = current.project.scenes.findIndex((s) => s.id === sceneId);
    if (index < 0)
      throw Object.assign(Error("シーンがありません"), { status: 404 });
    current.project.scenes[index] = scene as any;
    if ((scene as any)?.id !== sceneId)
      throw Object.assign(Error("シーンIDは維持してください"), { status: 400 });
    return this.save(current.project, revision);
  }
  review(id: string, review: Omit<Review, "createdAt">) {
    this.get(id, review.revision);
    const record = { ...review, createdAt: new Date().toISOString() };
    this.write(
      path.join(this.dir(id), `reviews/${review.revision}.json`),
      record,
    );
    return record;
  }
  getReview(id: string, revision: number): Review | undefined {
    try {
      return this.read(path.join(this.dir(id), `reviews/${revision}.json`));
    } catch (e) {
      if ((e as any).status !== 404) throw e;
    }
  }
}
