/* EnglishCoach 端到端测试 v2（Playwright + Edge）——覆盖全功能 */
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8001";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

  const step = (name, ok) => console.log((ok ? "✅" : "❌") + " " + name);

  try {
    // 1. 首页 + 队列
    await page.goto(BASE, { waitUntil: "networkidle" });
    step("首页加载", (await page.title()).includes("EnglishCoach"));
    step("队列页可见", await page.locator("#view-queue").isVisible());
    step("底部导航4个tab", (await page.locator(".nav-item").count()) === 4);

    // 2. 单词本 tab
    await page.locator('.nav-item[data-nav="words"]').click();
    await page.waitForTimeout(400);
    step("单词本可见", await page.locator("#view-words").isVisible());
    step("单词本有列表项", (await page.locator(".word-item").count()) > 0);
    await page.screenshot({ path: "e2e_words.png" });

    // 3. 故事 tab（可能空，验证空态不报错）
    await page.locator('.nav-item[data-nav="stories"]').click();
    await page.waitForTimeout(400);
    step("故事页可见", await page.locator("#view-stories").isVisible());

    // 4. 加词 tab + AI 生成（真调 DeepSeek——用新词避免重复，失败不算错）
    await page.locator('.nav-item[data-nav="add"]').click();
    await page.waitForTimeout(400);
    step("加词页可见", await page.locator("#view-add").isVisible());
    await page.locator("#add-input").fill("dog, house");
    await page.locator("#btn-add-generate").click();
    await page.waitForTimeout(15000); // AI 生成需要时间
    const resultText = await page.locator("#add-result").textContent();
    step("AI 生成词卡完成", resultText.includes("生成") || resultText.includes("已经"));
    console.log("   ↳ 加词结果:", resultText.trim().slice(0, 60));

    // 5. 回队列 → 开始学习 → 翻面
    await page.locator('.nav-item[data-nav="queue"]').click();
    await page.waitForTimeout(400);
    const studyBtn = await page.locator("#btn-start-study").isVisible();
    step("队列有学习按钮", studyBtn);

    if (studyBtn) {
      await page.locator("#btn-start-study").click();
      await page.waitForTimeout(500);
      step("进入学习页", await page.locator("#view-study").isVisible());
      const frontWord = await page.locator("#front-main").textContent();
      step(`卡片正面：${frontWord.trim()}`, frontWord.trim().length > 0);

      // 翻面
      await page.locator("#study-card").click();
      await page.waitForTimeout(700);
      step("翻面成功", await page.locator("#study-card").evaluate((el) => el.classList.contains("flipped")));
      step("评分区出现", await page.locator("#rating-area").isVisible());

      // 发音按钮存在
      step("正面发音按钮存在", await page.locator("#btn-speak-front").isVisible());

      // 评分第一张
      await page.locator('.btn-rating[data-rating="3"]').click();
      await page.waitForTimeout(900);
      const count = await page.locator("#study-count").textContent();
      step(`评分后进入下一张（${count.trim()}）`, /\/\s*\d+/.test(count.trim()));
    }

    // 6. 今日统计显示（回队列看）
    await page.locator(".nav-item[data-nav='queue']").click();
    await page.waitForTimeout(400);
    const reviewed = await page.locator("#stat-reviewed").textContent();
    const total = await page.locator("#stat-total").textContent();
    step(`今日统计（学${reviewed} 总${total}）`, Number(reviewed) > 0 && Number(total) > 0);
  } catch (e) {
    console.log("❌ 流程中断:", e.message);
    await page.screenshot({ path: "e2e_failure.png", fullPage: true });
    console.log("截图已保存 e2e_failure.png");
  }

  console.log("\n--- 控制台错误 ---");
  console.log(errors.length ? errors.join("\n") : "（无）");

  await browser.close();
})();
