import { promises as fs } from "node:fs";
import path from "node:path";
import { api, base } from "./client.ts";
import { validate } from "./core/validate.ts";
const [cmd, ...args] = process.argv.slice(2);
const read = async (file: string) =>
  JSON.parse(await fs.readFile(file, "utf8"));
try {
  let result: unknown;
  switch (cmd) {
    case "validate":
      result = validate(await read(args[0]));
      if ((result as any).errors.length) process.exitCode = 1;
      break;
    case "import": {
      const project = await read(args[0]);
      result = await api("/projects", {
        project,
        expectedRevision: Number(args[1] ?? 0),
      });
      break;
    }
    case "list":
      result = await api("/projects");
      break;
    case "get":
      result = await api(
        "/projects/" + args[0] + (args[1] ? "?revision=" + args[1] : ""),
      );
      break;
    case "export": {
      const r = await api("/projects/" + args[0]);
      await fs.writeFile(args[1], JSON.stringify(r.project, null, 2));
      result = { path: path.resolve(args[1]), revision: r.revision };
      break;
    }
    case "scene":
      result = await api(
        `/projects/${args[0]}/scenes/${args[2]}`,
        { revision: Number(args[1]), scene: await read(args[3]) },
        "PATCH",
      );
      break;
    case "review":
      result = await api(`/projects/${args[0]}/reviews`, await read(args[1]));
      break;
    case "audio":
    case "preview":
    case "render": {
      const revision = args[1]
        ? Number(args[1])
        : (await api("/projects/" + args[0])).revision;
      result = await api("/jobs", { projectId: args[0], revision, kind: cmd });
      break;
    }
    case "jobs":
      result = await api("/jobs");
      break;
    case "status":
      result = await api("/jobs/" + args[0]);
      break;
    case "cancel":
    case "retry":
      result = await api(`/jobs/${args[0]}/${cmd}`, {});
      break;
    case "wait": {
      for (;;) {
        const j = await api("/jobs/" + args[0]);
        if (!["queued", "running"].includes(j.status)) {
          result = j;
          if (j.status !== "succeeded") process.exitCode = 1;
          break;
        }
        console.error(`${j.phase} ${j.done}/${j.total}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
      break;
    }
    case "download": {
      const job = await api("/jobs/" + args[0]);
      const filename = args[1] ?? "video.mp4";
      if (!job.artifacts.includes(filename)) throw Error("成果物がありません");
      const output = args[2] ?? filename;
      const r = await fetch(
        `${base}/api/jobs/${job.id}/artifacts/${encodeURIComponent(filename)}`,
      );
      if (!r.ok) throw Error("取得に失敗しました");
      await fs.writeFile(output, Buffer.from(await r.arrayBuffer()));
      result = { path: path.resolve(output) };
      break;
    }
    case "asset": {
      const p = await read(args[0]),
        name = args[1],
        file = args[2],
        ext = path.extname(file).slice(1).toLowerCase(),
        type = ext === "jpg" ? "jpeg" : ext;
      if (!["svg", "png", "jpeg"].includes(type))
        throw Error("svg/png/jpegを指定してください");
      p.assets ??= {};
      p.assets[name] = {
        type,
        data: await fs.readFile(file, type === "svg" ? "utf8" : "base64"),
      };
      const v = validate(p);
      if (v.errors.length) throw Error(JSON.stringify(v.errors));
      await fs.writeFile(args[0], JSON.stringify(v.project, null, 2));
      result = { path: path.resolve(args[0]), asset: name };
      break;
    }
    default:
      result = {
        usage: [
          "npm start  # サービスを別ターミナルで起動",
          "npm run cli -- validate <project.json>",
          "npm run cli -- import <project.json> [expectedRevision=0]",
          "npm run cli -- list | get <id> [revision] | export <id> <file>",
          "npm run cli -- scene <id> <revision> <sceneId> <scene.json>",
          "npm run cli -- review <id> <review.json>",
          "npm run cli -- audio|preview|render <id> [revision]",
          "npm run cli -- status|wait|cancel|retry <jobId>",
          "npm run cli -- download <jobId> [artifact=video.mp4] [output]",
          "npm run cli -- asset <project.json> <assetId> <svg/png/jpeg>",
        ],
      };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(
    JSON.stringify(
      { error: (e as Error).message, issues: (e as any).issues },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
