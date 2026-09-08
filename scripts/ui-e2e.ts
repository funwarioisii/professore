import { chromium } from "playwright";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
const browser = await chromium.launch();
const id = "uitest" + Date.now();
const sample = JSON.parse(await fs.readFile("examples/oauth.json", "utf8"));
sample.id = id;
sample.title = "UI 操作検証";
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4318");
  page.on("dialog", (dialog) => void dialog.accept());
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 2, scenes: [{}] })),
    });
  await page.getByRole("alert").filter({ hasText: "/schemaVersion" }).waitFor();
  await page.locator("input[type=file]").setInputFiles({
    name: "ui.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(sample)),
  });
  await page.getByRole("button", { name: "構造検証", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "構造検証に成功" })
    .waitFor();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "リビジョン 1" }).waitFor();
  await page
    .locator(".beat-editor textarea")
    .first()
    .fill("UIから読み上げを修正しました。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "リビジョン 2" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "JSONを書き出す ↓" }).click(),
  ]);
  const exported = JSON.parse(
    await fs.readFile((await download.path())!, "utf8"),
  );
  assert.equal(
    exported.scenes[0].beats[0].narration,
    "UIから読み上げを修正しました。",
  );
  await page.locator("[data-project-id=oauth]").click();
  await page.getByRole("button", { name: /SCENE 02/ }).click();
  const frame = page.frameLocator("iframe");
  await frame.getByText("ユーザーのブラウザ", { exact: true }).waitFor();
  await page.screenshot({ path: "docs/evidence/ui.png", fullPage: true });
  await page.getByRole("button", { name: /生成・成果物/ }).click();
  const video = page.locator("video").first();
  await video.waitFor();
  const playback = await video.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    if (v.readyState < 2)
      await new Promise<void>((r, j) => {
        v.addEventListener("loadeddata", () => r(), { once: true });
        v.addEventListener("error", () => j(Error("decode failed")), {
          once: true,
        });
      });
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 500));
    const advanced = v.currentTime;
    v.pause();
    await new Promise<void>((resolve) => {
      v.addEventListener("seeked", () => resolve(), { once: true });
      v.currentTime = 80;
    });
    return {
      advanced,
      duration: v.duration,
      width: v.videoWidth,
      height: v.videoHeight,
      error: v.error?.message ?? null,
      seek: v.currentTime,
    };
  });
  assert(playback.advanced > 0);
  assert.equal(playback.width, 1920);
  assert.equal(playback.height, 1080);
  assert.equal(playback.error, null);
  const [mp4] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("link", { name: "video.mp4 ↓", exact: true })
      .first()
      .click(),
  ]);
  assert((await fs.stat((await mp4.path())!)).size > 10000);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "docs/evidence/ui.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        results: [
          "不正JSONの位置付きエラーと復帰・JSON取り込み・構造検証・保存",
          "beat台本編集とrevision 2のJSON書き出し",
          "Mermaid日本語ラベルを描画",
          "MP4の実デコード・時間進行・80秒地点へのシーク",
          "ブラウザの保存リンクからMP4取得",
        ],
        playback,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("UI edit, export, playback and download passed");
} finally {
  await browser.close();
}
