import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store } from "./core/store.ts";
import { Jobs } from "./core/jobs.ts";
import { validate } from "./core/validate.ts";
import { lockStore } from "./core/lock.ts";
export const port = Number(process.env.PROFESSORE_PORT ?? 4318);
export const root = path.resolve(process.env.PROFESSORE_HOME ?? ".professore");
const release = lockStore(root);
const store = new Store(root),
  jobs = new Jobs(store),
  app = express();
const origin = `http://127.0.0.1:${port}`;
app.use((req, res, next) => {
  if (
    req.headers.host !== `127.0.0.1:${port}` &&
    req.headers.host !== `localhost:${port}`
  )
    return res.status(403).json({ error: "Hostが不正です" });
  if (
    req.headers.origin &&
    req.headers.origin !== origin &&
    req.headers.origin !== `http://localhost:${port}`
  )
    return res.status(403).json({ error: "Originが不正です" });
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "外部サイトからの操作は禁止です" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'",
  );
  next();
});
app.use(express.json({ limit: "32mb" }));
app.get("/api/health", (_req, res) =>
  res.json({ name: "professore", version: "0.1.0", root, pid: process.pid }),
);
app.get("/api/projects", (_req, res) => res.json(store.list()));
app.post("/api/validate", (req, res) => res.json(validate(req.body)));
app.post("/api/projects", (req, res) =>
  res.json(
    store.save(
      req.body.project,
      z.number().int().min(0).parse(req.body.expectedRevision),
    ),
  ),
);
app.get("/api/projects/:id", (req, res) => {
  const r = store.get(
    req.params.id,
    req.query.revision ? Number(req.query.revision) : undefined,
  );
  res.json({
    ...r,
    review: store.getReview(req.params.id, r.revision) ?? null,
  });
});
app.patch("/api/projects/:id/scenes/:scene", (req, res) =>
  res.json(
    store.updateScene(
      req.params.id,
      z.number().int().positive().parse(req.body.revision),
      req.params.scene,
      req.body.scene,
    ),
  ),
);
app.post("/api/projects/:id/reviews", (req, res) =>
  res.json(
    store.review(
      req.params.id,
      z
        .object({
          revision: z.number().int().positive(),
          reviewer: z.string().min(1).max(100),
          fixes: z.array(z.string().max(10000)),
          unresolved: z.array(z.string().max(10000)),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.get("/api/jobs", (_req, res) => res.json(jobs.list()));
app.get("/api/jobs/:id", (req, res) => res.json(jobs.get(req.params.id)));
app.post("/api/jobs", (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      revision: z.number().int().positive(),
      kind: z.enum(["audio", "preview", "render"]).default("render"),
    })
    .strict()
    .parse(req.body);
  res.status(202).json(jobs.start(b.projectId, b.revision, b.kind));
});
app.post("/api/jobs/:id/cancel", (req, res) =>
  res.json(jobs.cancel(req.params.id)),
);
app.post("/api/jobs/:id/retry", (req, res) =>
  res.status(202).json(jobs.retry(req.params.id)),
);
app.get("/api/jobs/:id/artifacts/:file", (req, res) => {
  const file = jobs.artifact(req.params.id, req.params.file);
  if (req.query.download)
    res.download(file, path.basename(file), { dotfiles: "allow" });
  else res.sendFile(file, { dotfiles: "allow" });
});
const dist = fileURLToPath(new URL("../dist", import.meta.url));
app.use(express.static(dist));
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res
      .status(err.status ?? (err instanceof z.ZodError ? 400 : 500))
      .json({ error: err.message, issues: err.issues }),
);
// A single service owns disk mutations; listening happens before restart recovery is externally visible.
const server = app.listen(port, "127.0.0.1", () =>
  console.error(`Professore: ${origin}\n保存先: ${root}`),
);
server.on("error", (e) => {
  console.error(e.message);
  release();
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    jobs.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
