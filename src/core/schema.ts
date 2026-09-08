import { z } from "zod";
export const Id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const text = z.string().max(20000);
export const Event = z
  .object({
    target: z.string().max(130),
    action: z.enum(["show", "hide", "highlight", "unhighlight"]),
    at: z.enum(["start", "end"]).default("start"),
    fade: z.number().min(0).max(0.5).default(0),
  })
  .strict();
export const Beat = z
  .object({
    id: Id,
    narration: text.min(1),
    speech: text.min(1).optional(),
    before: z.number().min(0).max(10).default(0.2),
    after: z.number().min(0.1).max(10).default(0.4),
    events: z.array(Event).max(100).default([]),
  })
  .strict();
export const Scene = z
  .object({
    id: Id,
    title: text.min(1),
    purpose: text,
    layout: z.enum(["full", "diagram", "compare"]),
    body: text.default(""),
    elements: z
      .array(
        z
          .object({
            id: Id,
            kind: z.enum(["markdown", "mermaid", "asset"]),
            content: text.default(""),
            asset: Id.optional(),
            visible: z.boolean().default(true),
          })
          .strict(),
      )
      .max(12),
    beats: z.array(Beat).min(1).max(100),
  })
  .strict();
export const Project = z
  .object({
    schemaVersion: z.literal(1),
    id: Id,
    title: text.min(1),
    language: z.literal("ja-JP"),
    audience: text,
    prerequisites: z.array(text).default([]),
    learningGoals: z.array(text).min(1),
    outOfScope: z.array(text).default([]),
    targetDuration: z.number().positive().max(3600),
    sources: z.array(
      z.object({ title: text, url: z.url(), note: text.default("") }).strict(),
    ),
    settings: z
      .object({
        width: z
          .number()
          .int()
          .min(640)
          .max(3840)
          .refine((n) => n % 2 === 0),
        height: z
          .number()
          .int()
          .min(360)
          .max(2160)
          .refine((n) => n % 2 === 0),
        fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
        theme: z.enum(["midnight", "paper"]),
        font: z.enum(["Hiragino Sans", "Hiragino Kaku Gothic ProN"]),
        subtitles: z.boolean(),
        tts: z
          .object({
            provider: z.literal("macos-say"),
            voice: z.string().min(1).max(100),
            rate: z.number().int().min(80).max(400),
          })
          .strict(),
        pronunciations: z.record(
          z.string().min(1).max(100),
          z.string().max(200),
        ),
      })
      .strict(),
    assets: z
      .record(
        Id,
        z
          .object({
            type: z.enum(["svg", "png", "jpeg"]),
            data: z.string().max(8_000_000),
          })
          .strict(),
      )
      .default({}),
    scenes: z.array(Scene).min(1).max(100),
  })
  .strict();
export type Project = z.infer<typeof Project>;
export type Scene = z.infer<typeof Scene>;
export type Beat = z.infer<typeof Beat>;
export type Event = z.infer<typeof Event>;
export type Issue = { path: string; message: string };
