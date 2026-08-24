/* 课程前端 E2E：入口卡 → 学习页 → 词/对话 → 学完下一课 */
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
    await page.waitForTimeout(800);

    // 入口卡
    step("课程入口卡可见", await page.locator("#lesson-entry").isVisible());
    const entryTitle = await page.locator("#lesson-entry-title").textContent();
    console.log("   ↳ 入口:", entryTitle);

    // 打开课程
    await page.locator("#btn-open-lesson").click();
    await page.waitForTimeout(800);
    step("课程学习页打开", await page.locator("#view-lesson").isVisible());
    step("课程标题显示", (await page.locator("#lesson-title").textContent()).length > 0);
    const wordCount = await page.locator("#lesson-words .word-item").count();
    step(`词表 ${wordCount} 个词`, wordCount > 0);
    const dlgCount = await page.locator("#lesson-dialogue .lesson-dialogue-row").count();
    step(`对话 ${dlgCount} 句`, dlgCount > 0);

    // 点词发音按钮
    await page.locator("#lesson-words .speak-mini").first().click();
    await page.waitForTimeout(1500);
    step("词发音触发（无报错）", errors.length === 0);

    // 点对话句子听发音
    await page.locator("#lesson-dialogue .lesson-dialogue-row").first().click();
    await page.waitForTimeout(1200);

    // 点词标记掌握
    await page.locator("#lesson-words .word-item").first().click();
    await page.waitForTimeout(600);
    step("点词标记掌握（mastered class）",
      (await page.locator("#lesson-words .word-item").first().getAttribute("class")).includes("word-mastered"));

    // 截图跳过（Google Fonts 加载阻塞，与功能无关）

    // 学完本课 → 下一课
    await page.locator("#btn-lesson-done").click();
    await page.waitForTimeout(15000); // AI 生成下一课
    const level = await page.locator("#lesson-level").textContent();
    step(`学完进入下一课（现在 ${level}）`, level.includes("2"));
  } catch (e) {
    console.log("❌ 中断:", e.message);
    await page.screenshot({ path: "e2e_lesson_failure.png", fullPage: true });
  }
  console.log("\n--- 页面错误 ---");
  console.log(errors.length ? errors.join("\n") : "（无）");
  await browser.close();
})();
