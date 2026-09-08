import { DOMParser } from "@xmldom/xmldom";
import { Project, type Issue } from "./schema.ts";
const tags = new Set(
  "svg g path rect circle ellipse line polyline polygon text tspan defs marker linearGradient radialGradient stop clipPath title desc".split(
    " ",
  ),
);
const attrs = new Set(
  "xmlns id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity stroke-opacity transform font-size font-family font-weight text-anchor dominant-baseline dx dy offset stop-color stop-opacity marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform clip-path preserveAspectRatio".split(
    " ",
  ),
);
export function svgIds(data: string): Set<string> {
  if (/<!|<\?/.test(data))
    throw Error("SVGのDOCTYPE、宣言、コメントは使用できません");
  const doc = new DOMParser({
    onError: () => {
      throw Error("SVG XMLが不正です");
    },
  }).parseFromString(data, "image/svg+xml");
  if (doc.documentElement?.tagName !== "svg")
    throw Error("SVGルートが必要です");
  const ids = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName("*"))) {
    if (!tags.has(el.tagName))
      throw Error(`SVG要素 ${el.tagName} は未対応です`);
    for (const a of Array.from(el.attributes)) {
      if (!attrs.has(a.name)) throw Error(`SVG属性 ${a.name} は未対応です`);
      if (a.name === "xmlns" && a.value !== "http://www.w3.org/2000/svg")
        throw Error("SVG namespaceが不正です");
      if (
        a.name !== "xmlns" &&
        /[<>\\]|(?:https?:|data:|file:|javascript:|@import|expression\s*\()/i.test(
          a.value,
        )
      )
        throw Error("SVGの外部参照は禁止です");
      if (
        /url\s*\(/i.test(a.value) &&
        !/^url\(#[A-Za-z][\w-]*\)$/.test(a.value)
      )
        throw Error("SVG参照は内部IDのみ使用できます");
    }
    const id = el.getAttribute("id");
    if (id) {
      if (!/^[A-Za-z][\w-]*$/.test(id) || ids.has(id))
        throw Error("SVG IDが不正・重複しています");
      ids.add(id);
    }
  }
  return ids;
}
export function validate(input: unknown): {
  project?: Project;
  errors: Issue[];
  warnings: Issue[];
} {
  const parsed = Project.safeParse(input);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map((e) => ({
        path: "/" + e.path.join("/"),
        message: e.message,
      })),
      warnings: [],
    };
  const p = parsed.data,
    errors: Issue[] = [],
    warnings: Issue[] = [];
  const seen = new Set<string>();
  const assetIds = new Map<string, Set<string>>();
  const add = (path: string, message: string) => errors.push({ path, message });
  for (const [key, a] of Object.entries(p.assets)) {
    try {
      if (a.type === "svg") assetIds.set(key, svgIds(a.data));
      else {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data))
          throw Error("画像はbase64形式が必要です");
        const b = Buffer.from(a.data, "base64");
        if (
          a.type === "png" &&
          !b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          throw Error("PNGヘッダーが不正です");
        if (a.type === "jpeg" && (b[0] !== 255 || b[1] !== 216))
          throw Error("JPEGヘッダーが不正です");
      }
    } catch (e) {
      add("/assets/" + key, (e as Error).message);
    }
  }
  const id = (v: string, path: string) => {
    if (seen.has(v)) add(path, "IDが重複しています: " + v);
    seen.add(v);
  };
  p.scenes.forEach((s, si) => {
    const sp = "/scenes/" + si;
    id(s.id, sp + "/id");
    s.elements.forEach((el, ei) => {
      const ep = sp + "/elements/" + ei;
      id(el.id, ep + "/id");
      if (
        el.kind === "asset" &&
        (!el.asset || !Object.hasOwn(p.assets, el.asset))
      )
        add(ep + "/asset", "アセットが存在しません");
      if (
        el.kind === "mermaid" &&
        /%%\{|^\s*---|\bclick\s|https?:|<|>\s*script|@\{/im.test(el.content)
      )
        add(ep + "/content", "Mermaid設定・HTML・外部リンク・画像は禁止です");
      if (el.content.length > 1800)
        warnings.push({
          path: ep,
          message: "文字量が多いため、見切れをプレビューで確認してください",
        });
    });
    s.beats.forEach((b, bi) => {
      const bp = sp + "/beats/" + bi;
      id(b.id, bp + "/id");
      b.events.forEach((ev, ei) => {
        const [target, sub, ...rest] = ev.target.split("#"),
          el = s.elements.find((e) => e.id === target);
        if (
          !el ||
          rest.length ||
          (sub !== undefined &&
            (!sub || el.kind !== "asset" || !assetIds.get(el.asset!)?.has(sub)))
        )
          add(
            bp + "/events/" + ei + "/target",
            "表示対象が存在しません: " + ev.target,
          );
      });
      if (b.narration.length > 180)
        warnings.push({
          path: bp + "/narration",
          message: "長い字幕です。自然な文の区切りでbeatを分けてください",
        });
    });
  });
  return { project: p, errors, warnings };
}
export function requireProject(input: unknown): Project {
  const v = validate(input);
  if (v.errors.length)
    throw Object.assign(Error("原稿の検証に失敗しました"), {
      status: 400,
      issues: v.errors,
    });
  return v.project!;
}
