import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { api } from "./client.ts";
const server = new McpServer({ name: "professore", version: "0.1.0" });
const wrap = (fn: (args: any) => Promise<any>) => async (args: any) => {
  try {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(await fn(args)) },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: (e as Error).message,
            issues: (e as any).issues,
          }),
        },
      ],
    };
  }
};
server.registerTool(
  "list_projects",
  { description: "ローカル原稿の一覧", inputSchema: {} },
  wrap(() => api("/projects")),
);
server.registerTool(
  "get_project",
  {
    description: "原稿・リビジョン・意味レビューを取得",
    inputSchema: {
      id: z.string(),
      revision: z.number().int().positive().optional(),
    },
  },
  wrap((a) =>
    api("/projects/" + a.id + (a.revision ? "?revision=" + a.revision : "")),
  ),
);
server.registerTool(
  "validate_project",
  {
    description: "構造・参照・安全性を検証。内容の正しさは判定しません",
    inputSchema: { project: z.record(z.string(), z.unknown()) },
  },
  wrap((a) => api("/validate", a.project)),
);
server.registerTool(
  "save_project",
  {
    description: "新規はexpectedRevision=0。更新は取得済みリビジョンを指定",
    inputSchema: {
      project: z.record(z.string(), z.unknown()),
      expectedRevision: z.number().int().min(0),
    },
  },
  wrap((a) => api("/projects", a)),
);
server.registerTool(
  "update_scene",
  {
    description: "IDを維持してシーンを更新。競合時は再取得",
    inputSchema: {
      id: z.string(),
      revision: z.number().int().positive(),
      sceneId: z.string(),
      scene: z.record(z.string(), z.unknown()),
    },
  },
  wrap((a) =>
    api(
      `/projects/${a.id}/scenes/${a.sceneId}`,
      { revision: a.revision, scene: a.scene },
      "PATCH",
    ),
  ),
);
server.registerTool(
  "record_review",
  {
    description: "ホストAIが実施した意味レビューをリビジョンに記録",
    inputSchema: {
      id: z.string(),
      revision: z.number().int().positive(),
      reviewer: z.string(),
      fixes: z.array(z.string()),
      unresolved: z.array(z.string()),
    },
  },
  wrap(({ id, ...review }) => api(`/projects/${id}/reviews`, review)),
);
server.registerTool(
  "start_job",
  {
    description:
      "音声・静止画プレビュー・MP4ジョブを開始して即座にIDを返す。独立サービスが処理",
    inputSchema: {
      projectId: z.string(),
      revision: z.number().int().positive(),
      kind: z.enum(["audio", "preview", "render"]),
    },
  },
  wrap((a) => api("/jobs", a)),
);
server.registerTool(
  "get_job",
  {
    description:
      "進捗・エラー・成果物名を取得。成果物URLは http://127.0.0.1:4318/api/jobs/{id}/artifacts/{file}",
    inputSchema: { id: z.string() },
  },
  wrap((a) => api("/jobs/" + a.id)),
);
server.registerTool(
  "list_jobs",
  { description: "生成ジョブ一覧", inputSchema: {} },
  wrap(() => api("/jobs")),
);
for (const action of ["cancel", "retry"])
  server.registerTool(
    action + "_job",
    {
      description:
        action === "cancel"
          ? "ジョブをキャンセル"
          : "固定リビジョンで再実行し新ジョブIDを返す",
      inputSchema: { id: z.string() },
    },
    wrap((a) => api(`/jobs/${a.id}/${action}`, {})),
  );
await server.connect(new StdioServerTransport());
