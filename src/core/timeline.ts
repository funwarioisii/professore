import type { Project } from "./schema.ts";
export const SAMPLE_RATE = 48000;
export type AudioEntry = {
  sceneId: string;
  beatId: string;
  file: string;
  key: string;
  samples: number;
  cached: boolean;
};
export type Timing = AudioEntry & {
  startFrame: number;
  endFrame: number;
  speechStartSample: number;
  speechEndSample: number;
  before: number;
  after: number;
};
export function timeline(p: Project, audio: AudioEntry[]) {
  let samples = 0;
  const result: Timing[] = [];
  const fps = p.settings.fps;
  for (const s of p.scenes)
    for (const b of s.beats) {
      const a = audio.find((a) => a.beatId === b.id);
      if (!a || a.samples <= 0) throw Error("音声がありません: " + b.id);
      const before = Math.round(b.before * SAMPLE_RATE),
        after = Math.round(b.after * SAMPLE_RATE),
        startFrame = Math.ceil((samples * fps) / SAMPLE_RATE);
      const speechStartSample = samples + before;
      samples += before + a.samples + after;
      result.push({
        ...a,
        startFrame,
        endFrame: Math.ceil((samples * fps) / SAMPLE_RATE),
        speechStartSample,
        speechEndSample: speechStartSample + a.samples,
        before,
        after,
      });
    }
  return {
    beats: result,
    totalFrames: Math.ceil((samples * fps) / SAMPLE_RATE),
    totalSamples: samples,
    fps,
  };
}
export type Timeline = ReturnType<typeof timeline>;
