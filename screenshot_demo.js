/* 生成演示截图：队列页 / 学习翻面 / 单词本 / 故事阅读 */
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  await page.goto("http://127.0.0.1:8001/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "docs/screenshot-1-queue.png" });

  // 学习页翻面
  if (await page.locator("#btn-start-study").isVisible()) {
    await page.locator("#btn-start-study").click();
    await page.waitForTimeout(800);
    await page.locator("#study-card").click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "docs/screenshot-2-study.png" });
  }

  // 单词本
  await page.locator('.nav-item[data-nav="words"]').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "docs/screenshot-3-words.png" });

  // 故事阅读
  await page.locator('.nav-item[data-nav="stories"]').click();
  await page.waitForTimeout(1500);
  const storyCount = await page.locator(".story-item").count();
  if (storyCount > 0) {
    await page.locator(".story-item").first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "docs/screenshot-4-story.png" });
  } else {
    console.log("故事列表为空，跳过故事截图");
  }

  await browser.close();
  console.log("截图完成：docs/screenshot-*.png");
})();
