import { chromium } from "playwright";
import { promises as fs } from "node:fs";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4318");
  await page.locator("[data-project-id=oauth]").click();
  await page.getByRole("button", { name: /SCENE 02/ }).click();
  await page.waitForTimeout(1500);
  await fs.mkdir("docs/evidence", { recursive: true });
  await page.screenshot({ path: "docs/evidence/ui.png", fullPage: true });
  const frame = page.frames().find((f) => f.url().includes("/preview.html"))!;
  console.log(
    JSON.stringify(
      {
        errors,
        preview: await frame.locator("#root").innerText(),
        labels: await frame.locator("svg text").allTextContents(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
