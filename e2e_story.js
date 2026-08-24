/* E2E：故事生成 → 阅读 → 点词弹卡 → 评分 */
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8001";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  const step = (name, ok) => console.log((ok ? "✅" : "❌") + " " + name);

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // 加词（等完成标志出现再继续）
    await page.locator('.nav-item[data-nav="add"]').click();
    await page.locator("#add-input").fill("sun, moon, star, sky, rain, snow, wind, cloud");
    await page.locator("#btn-add-generate").click();
    try {
      await page.waitForFunction(() => {
        const t = document.querySelector("#add-result")?.textContent || "";
        return t.includes("生成") || t.includes("已经") || t.includes("失败");
      }, { timeout: 60000 });
    } catch {}
    console.log("   ↳ 加词:", (await page.locator("#add-result").textContent()).trim().slice(0, 50));

    // 生成故事
    await page.locator('.nav-item[data-nav="stories"]').click();
    await page.waitForTimeout(400);
    await page.locator("#btn-new-story").click();
    try {
      await page.waitForFunction(() => {
        const btn = document.querySelector("#btn-new-story");
        return btn && btn.textContent.includes("生成新故事") && btn.textContent !== "生成中…";
      }, { timeout: 60000 });
    } catch {}
    await page.waitForTimeout(1500);
    const storyItems = await page.locator(".story-item").count();
    step(`故事列表有 ${storyItems} 篇`, storyItems > 0);

    // 打开故事
    await page.locator(".story-item").first().click();
    await page.waitForTimeout(600);
    step("故事阅读页打开", await page.locator("#view-story-read").isVisible());
    const swCount = await page.locator(".sw").count();
    step(`故事里有 ${swCount} 个可点词`, swCount > 0);

    // 点词弹卡
    await page.locator(".sw").first().click();
    await page.waitForTimeout(400);
    step("点词弹卡", await page.locator("#word-modal").isVisible());
    const mw = await page.locator("#modal-word").textContent();
    step(`弹卡单词：${mw}`, mw.length > 0);

    // 评分
    await page.locator('.modal-rating .btn-rating[data-rating="3"]').click();
    await page.waitForTimeout(800);
    const fb = await page.locator("#modal-feedback").textContent();
    step(`评分反馈：${fb.trim().slice(0, 30)}`, fb.includes("已记录"));

    await page.screenshot({ path: "e2e_story.png" });
  } catch (e) {
    console.log("❌ 中断:", e.message);
    await page.screenshot({ path: "e2e_story_failure.png", fullPage: true });
  }
  console.log("\n--- 控制台错误 ---");
  console.log(errors.length ? errors.join("\n") : "（无）");
  await browser.close();
})();
