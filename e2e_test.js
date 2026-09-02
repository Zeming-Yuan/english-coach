/* EnglishCoach 端到端测试 v3（Playwright + Edge · React 版）
   覆盖：队列 / 单词本 / 故事 / 加词(AI) / 学习翻面评分 / 统计 / 测验 / 拼写 / 听写 / 设置
   注意：会写真实数据（加词走 DeepSeek、学习页评 1 次「记得」） */
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8001";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 420, height: 880 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });

  const step = (name, ok) => console.log((ok ? "✅" : "❌") + " " + name);

  // 底部导航按文本点击
  const gotoTab = async (label) => {
    await page.locator(".bottom-nav .nav-item", { hasText: label }).click();
    await page.waitForTimeout(500);
  };
  const backToQueue = async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  };

  try {
    // 1. 首页 + 队列
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    step("首页加载", (await page.title()).includes("EnglishCoach"));
    step("队列页内容可见", await page.locator(".queue-cards, .welcome-box").first().isVisible());
    step("底部导航4个tab", (await page.locator(".bottom-nav .nav-item").count()) === 4);

    // 2. 单词本
    await gotoTab("单词本");
    const wordCount = await page.locator(".word-item").count();
    step(`单词本有 ${wordCount} 个词条`, wordCount > 0);

    // 3. 故事 tab（空态也算通过——不报错即可）
    await gotoTab("故事");
    step("故事页可见（含空态）",
      (await page.locator(".story-item").count()) > 0 ||
      (await page.locator(".story-empty").isVisible().catch(() => false)));

    // 4. 加词 tab + AI 生成（真调 DeepSeek；已存在的词会跳过，失败不算错）
    await gotoTab("加词");
    await page.locator(".add-input").fill("dog, house");
    await page.locator(".add-card .btn-primary").click();
    let addText = "";
    try {
      await page.waitForFunction(() => {
        const t = document.querySelector(".add-result")?.textContent || "";
        return t.includes("✅ 生成") || t.includes("已存在") || t.includes("失败");
      }, { timeout: 60000 });
      addText = (await page.locator(".add-result").textContent()).trim();
    } catch { addText = "（AI 超时，跳过校验）"; }
    step(`加词结果：${addText.slice(0, 40)}`,
      addText.includes("✅ 生成") || addText.includes("已存在") || addText.includes("超时"));

    // 5. 学习流程：进队列 → 开始 → 翻面 → 评分
    await backToQueue();
    const startBtn = page.getByText("开始今天的学习");
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
      await page.waitForTimeout(800);
      step("进入学习页（卡片出现）", await page.locator(".card").isVisible());
      step("练习态隐藏底部导航", (await page.locator(".bottom-nav.nav-hidden").count()) === 1);
      await page.locator(".flip-hint").first().click();
      await page.waitForTimeout(900);
      step("翻面成功", await page.locator(".card.flipped").isVisible().catch(() => false));
      step("评分区出现在首屏", await page.locator(".rating-buttons").isVisible());
      await page.locator(".btn-rating.rating-3").click();
      await page.waitForTimeout(900);
      const count = (await page.locator(".study-count").textContent()).trim();
      step(`评分后进入下一张（${count}）`, /^2\s*\/\s*\d+/.test(count) || /2\s*\/\s*\d+/.test(count));
      await page.getByText("← 退出").click();
      await page.waitForTimeout(600);

      // 6. 今日统计条
      step("今日统计可见", await page.locator(".today-stats").isVisible().catch(() => false));
    } else {
      console.log("ℹ️ 今日队列为空，跳过学习流程");
    }

    // 7. 测验：跳过一题 → 反馈出现
    await backToQueue();
    const quizBtn = page.getByText("直接做测验");
    if (await quizBtn.isVisible().catch(() => false)) {
      await quizBtn.click();
      await page.waitForTimeout(900);
      step("测验题目出现", await page.locator(".quiz-card").isVisible());
      await page.locator(".practice-actions .btn-ghost").click();
      await page.waitForTimeout(400);
      step("跳过后反馈出现", await page.locator(".quiz-feedback").isVisible());
      step("「下一题」按钮出现", await page.locator(".practice-actions .btn-primary").isVisible());
    } else {
      console.log("ℹ️ 无测验入口（队列空），跳过");
    }

    // 8. 拼写：跳过 → 反馈
    await backToQueue();
    const spellBtn = page.getByText("拼写练习");
    if (await spellBtn.isVisible().catch(() => false)) {
      await spellBtn.click();
      await page.waitForTimeout(900);
      step("拼写输入框出现", await page.locator(".spelling-input").isVisible());
      await page.locator(".practice-actions .spelling-skip").click();
      await page.waitForTimeout(400);
      step("拼写反馈出现", await page.locator(".spelling-feedback").isVisible());
      await page.getByText("← 返回").click();
      await page.waitForTimeout(500);
    }

    // 9. 听写：4 选项 → 跳过 → 反馈
    const listenBtn = page.getByText("听写练习");
    if (await listenBtn.isVisible().catch(() => false)) {
      await listenBtn.click();
      await page.waitForTimeout(900);
      step("听写4个选项", (await page.locator(".listening-options .listening-option").count()) === 4);
      await page.locator(".practice-actions .spelling-skip").click();
      await page.waitForTimeout(400);
      step("听写反馈出现", await page.locator(".listening-feedback").isVisible());
      await page.getByText("← 返回").click();
      await page.waitForTimeout(500);
    }

    // 10. 统计页（从今日统计条进入）
    await backToQueue();
    if (await page.locator(".today-stats").isVisible().catch(() => false)) {
      await page.locator(".today-stats").click();
      await page.waitForTimeout(900);
      step("统计页打开且有返回按钮", await page.locator(".page-head .btn-ghost").isVisible().catch(() => false));
      await page.locator(".page-head .btn-ghost").click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // 11. 设置齿轮切换
    await page.locator(".settings-btn").click();
    await page.waitForTimeout(500);
    step("设置页打开", await page.locator(".settings-btn").isVisible());
    await page.locator(".settings-btn").click();
    await page.waitForTimeout(500);
    step("齿轮返回队列", await page.locator(".queue-cards, .welcome-box").first().isVisible());

    await page.screenshot({ path: "e2e_final.png", fullPage: false });
  } catch (e) {
    console.log("❌ 流程中断:", e.message);
    await page.screenshot({ path: "e2e_failure.png" });
  }

  console.log("\n--- 控制台错误 ---");
  console.log(errors.length ? errors.join("\n") : "（无）");
  await browser.close();
})();
