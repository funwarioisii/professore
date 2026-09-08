import type { Scene } from "./schema.ts";
import type { Timeline } from "./timeline.ts";
export function stateAt(scene: Scene, timeline: Timeline, frame: number) {
  const state: Record<
    string,
    { visible: boolean; highlight: boolean; opacity: number }
  > = {};
  for (const e of scene.elements)
    state[e.id] = {
      visible: e.visible,
      highlight: false,
      opacity: e.visible ? 1 : 0,
    };
  const events = scene.beats
    .flatMap((beat) => {
      const t = timeline.beats.find((t) => t.beatId === beat.id)!;
      return beat.events.map((event) => ({
        event,
        at:
          event.at === "start"
            ? t.startFrame
            : Math.ceil((t.speechEndSample * timeline.fps) / 48000),
      }));
    })
    .sort((a, b) => a.at - b.at);
  for (const { event, at } of events) {
    if (frame < at) continue;
    const prev = state[event.target] ?? {
      visible: true,
      highlight: false,
      opacity: 1,
    };
    const progress = event.fade
      ? Math.min(1, (frame - at + 1) / (event.fade * timeline.fps))
      : 1;
    state[event.target] = { ...prev };
    const next = state[event.target];
    if (event.action === "show") {
      next.visible = true;
      next.opacity = progress;
    } else if (event.action === "hide") {
      next.visible = progress < 1;
      next.opacity = 1 - progress;
    } else next.highlight = event.action === "highlight";
  }
  return state;
}
