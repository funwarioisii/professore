import React from "react";
import { stateAt } from "../core/visual.ts";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import mermaid from "mermaid";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Project, Scene } from "../core/schema.ts";
import type { Timeline } from "../core/timeline.ts";
export type Payload = { project: Project; timeline: Timeline; frame: number };
const md = (s: string) =>
  DOMPurify.sanitize(marked.parse(s, { async: false }) as string, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "strong",
      "em",
      "br",
      "blockquote",
    ],
    ALLOWED_ATTR: [],
  });
const diagrams = new Map<string, string>();
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  theme: "dark",
  fontFamily: "Hiragino Sans",
  flowchart: { htmlLabels: false },
  maxTextSize: 20000,
});
export async function prepare(project: Project) {
  const fontName =
    project.settings.font === "Hiragino Sans"
      ? "HiraginoSans-W3"
      : "HiraKakuProN-W3";
  const face = new FontFace("ProfessoreCheck", `local("${fontName}")`);
  await face.load();
  await document.fonts.load(`32px "${project.settings.font}"`);
  if (!document.fonts.check(`32px "${project.settings.font}"`))
    throw Error("日本語フォントを読み込めません");
  await document.fonts.ready;
  for (const s of project.scenes)
    for (const e of s.elements)
      if (e.kind === "mermaid" && !diagrams.has(e.content)) {
        const { svg } = await mermaid.render(
          "diagram" + diagrams.size,
          e.content,
        );
        diagrams.set(
          e.content,
          DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "a", "image"],
          }),
        );
      }
}
export function Slide({ project: p, timeline, frame }: Payload) {
  const t =
    timeline.beats.find((b) => b.startFrame <= frame && frame < b.endFrame) ??
    timeline.beats.at(-1)!;
  const scene = p.scenes.find((s) => s.id === t.sceneId)!,
    beat = scene.beats.find((b) => b.id === t.beatId)!,
    state = stateAt(scene, timeline, frame);
  const sceneNumber = p.scenes.indexOf(scene) + 1;
  const subtitle =
    p.settings.subtitles &&
    frame >= Math.floor((t.speechStartSample * timeline.fps) / 48000) &&
    frame < Math.ceil((t.speechEndSample * timeline.fps) / 48000)
      ? beat.narration
      : "";
  return (
    <div
      className={"slide " + p.settings.theme}
      style={{
        width: p.settings.width,
        height: p.settings.height,
        fontFamily: `"${p.settings.font}",sans-serif`,
        fontSize: p.settings.width / 58,
      }}
    >
      <header>
        <span>PROFESSORE / {p.title}</span>
        <span>
          {String(sceneNumber).padStart(2, "0")} /{" "}
          {String(p.scenes.length).padStart(2, "0")}
        </span>
      </header>
      <h1 data-check>{scene.title}</h1>
      <main className={"layout " + scene.layout}>
        {scene.body && (
          <div
            className="body prose"
            data-check
            dangerouslySetInnerHTML={{ __html: md(scene.body) }}
          />
        )}
        <div className="elements">
          {scene.elements.map((e) => {
            const st = state[e.id],
              asset = e.asset ? p.assets[e.asset] : undefined;
            return (
              <div
                key={e.id}
                data-element={e.id}
                data-check
                className={
                  "element " + e.kind + (st.highlight ? " highlighted" : "")
                }
                style={{
                  opacity: st.opacity,
                  visibility: st.visible ? "visible" : "hidden",
                }}
              >
                {e.kind === "markdown" ? (
                  <div
                    className="prose"
                    dangerouslySetInnerHTML={{ __html: md(e.content) }}
                  />
                ) : e.kind === "mermaid" ? (
                  <div
                    className="graphic"
                    dangerouslySetInnerHTML={{
                      __html: diagrams.get(e.content) ?? "",
                    }}
                  />
                ) : asset?.type === "svg" ? (
                  <div
                    className="graphic asset-svg"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(asset.data, {
                        USE_PROFILES: { svg: true },
                        FORBID_TAGS: ["style", "a", "image", "foreignObject"],
                      }),
                    }}
                  />
                ) : asset ? (
                  <img
                    src={`data:image/${asset.type};base64,${asset.data}`}
                    alt={e.id}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
      <footer>
        <span>{scene.purpose}</span>
        <span>
          {p.language} · {p.settings.fps} FPS
        </span>
      </footer>
      <div className="subtitle" data-check>
        {subtitle}
      </div>
      <div
        className="progress"
        style={{ width: `${(frame / timeline.totalFrames) * 100}%` }}
      />
    </div>
  );
}
let renderRequest = 0;
const root = createRoot(document.getElementById("root")!);
(window as any).renderSlide = async (payload: Payload) => {
  const request = ++renderRequest;
  await prepare(payload.project);
  if (request !== renderRequest) return [];
  flushSync(() => root.render(<Slide {...payload} />));
  const scene = payload.project.scenes.find(
    (s) =>
      s.id ===
      (payload.timeline.beats.find(
        (t) => t.startFrame <= payload.frame && payload.frame < t.endFrame,
      ) ?? payload.timeline.beats.at(-1))!.sceneId,
  )!;
  // React can reuse SVG DOM when scrubbing backwards. Reset our previous effects first.
  for (const node of document.querySelectorAll(".asset-svg [style]"))
    node.removeAttribute("style");
  const state = stateAt(scene, payload.timeline, payload.frame);
  for (const [target, st] of Object.entries(state)) {
    const [el, sub] = target.split("#");
    if (!sub) continue;
    const container = Array.from(
      document.querySelectorAll("[data-element]"),
    ).find((e) => e.getAttribute("data-element") === el);
    const node = container?.querySelector(`[id="${sub}"]`) as SVGElement | null;
    if (node) {
      node.style.opacity = String(st.opacity);
      node.style.visibility = st.visible ? "visible" : "hidden";
      node.style.filter = st.highlight
        ? "drop-shadow(0px 0px 9px #fbbf24)"
        : "";
      if (st.highlight) node.style.stroke = "#fbbf24";
      else node.style.removeProperty("stroke");
    }
  }
  await Promise.all(Array.from(document.images).map((i) => i.decode()));
  await document.fonts.ready;
  return Array.from(document.querySelectorAll("[data-check]"))
    .filter(
      (e) =>
        e.scrollHeight > e.clientHeight + 2 ||
        e.scrollWidth > e.clientWidth + 2,
    )
    .map((e) => e.getAttribute("data-element") ?? e.className);
};
window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  try {
    await (window as any).renderSlide(e.data);
  } catch (err) {
    document.getElementById("root")!.textContent =
      "プレビューエラー: " + (err as Error).message;
  }
});
