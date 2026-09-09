import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "professore-tts-ui-"));
const port = 4397;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["src/server.ts"], {
  env: {
    ...process.env,
    PROFESSORE_HOME: home,
    PROFESSORE_PORT: String(port),
    PROFESSORE_AQUESTALK_PLAYER: path.join(home, "not-installed"),
  },
  stdio: "pipe",
});
let logs = "";
server.stderr.on("data", (d) => (logs += d));
const browser = await chromium.launch();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (server.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator("input[type=file]").setInputFiles("examples/oauth.json");
  await page
    .getByLabel("読み上げ音声", { exact: true })
    .selectOption("aquestalk-player");
  await page.getByLabel("プリセット名", { exact: true }).fill("確認用の声");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "リビジョン 1" }).waitFor();
  let record = await (await fetch(base + "/api/projects/oauth")).json();
  assert.equal(record.project.settings.tts.provider, "aquestalk-player");
  assert.equal(record.project.settings.tts.preset, "確認用の声");
  await page.reload();
  await page.locator("[data-project-id=oauth]").click();
  assert.equal(
    await page.getByLabel("プリセット名", { exact: true }).inputValue(),
    "確認用の声",
  );
  await page
    .getByRole("button", { name: "プリセット変更を反映", exact: true })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "リビジョン 2" }).waitFor();
  record = await (await fetch(base + "/api/projects/oauth")).json();
  assert.notEqual(record.project.settings.tts.cacheVersion, "1");
  await page.screenshot({ path: "/tmp/professore-tts-ui.png", fullPage: true });
  await page.getByRole("button", { name: "MP4を生成 ↗", exact: true }).click();
  await page.getByRole("button", { name: /生成・成果物/ }).click();
  await page.getByText(/AquesTalkPlayerが見つかりません/).waitFor();
  await page
    .getByLabel("読み上げ音声", { exact: true })
    .selectOption("macos-say");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "リビジョン 3" }).waitFor();
  record = await (await fetch(base + "/api/projects/oauth")).json();
  assert.deepEqual(record.project.settings.tts, {
    provider: "macos-say",
    voice: "Kyoko",
    rate: 185,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: TTS selection, preset save/reload, cache refresh, missing app error, macOS fallback selection",
  );
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) resolve();
    else server.once("exit", () => resolve());
  });
  await fs.rm(home, { recursive: true, force: true });
}
