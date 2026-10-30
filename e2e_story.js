/* E2E v3（React 版）：加词 → 生成故事 → 阅读 → 点词弹面板 → 评分
   注意：真调 DeepSeek（加词 + 故事生成），并写入真实数据 */
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8001";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 420, height: 880 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // 故事生成的业务拒绝（新词不足返回 400）是预期路径，不计为错误
    if (msg.text().includes("400") && expectGenerate400) return;
    errors.push("console: " + msg.text());
  });
  page.on("response", (r) => {
    if (r.status() === 400 && r.url().includes("/api/stories/generate")) expectGenerate400 = true;
  });
  let expectGenerate400 = false;
  const step = (name, ok) => console.log((ok ? "✅" : "❌") + " " + name);

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // 1. 加词（给故事备料；已存在的词会跳过，AI 失败不阻塞）
    await page.locator(".bottom-nav .nav-item", { hasText: "加词" }).click();
    await page.waitForTimeout(500);
    await page.locator(".add-input").fill("sun, moon, star, sky, rain, snow, wind, cloud");
    await page.locator(".add-card .btn-primary").click();
    let addText = "";
    try {
      await page.waitForFunction(() => {
        const t = document.querySelector(".add-result")?.textContent || "";
        return t.includes("✅ 生成") || t.includes("已存在") || t.includes("失败");
      }, { timeout: 60000 });
      addText = (await page.locator(".add-result").textContent()).trim();
    } catch { addText = "AI 超时"; }
    console.log("   ↳ 加词:", addText.slice(0, 50));

    // 2. 生成故事
    await page.locator(".bottom-nav .nav-item", { hasText: "故事" }).click();
    await page.waitForTimeout(600);
    const before = await page.locator(".story-item").count();
    const genBtn = page.locator(".page-head .btn-primary");
    step("「生成新故事」按钮存在", await genBtn.isVisible().catch(() => false));
    if (await genBtn.isVisible().catch(() => false)) {
      await genBtn.click();
      // 等列表新增一篇；若词不足会弹「生成失败」toast（业务拒绝，也算通过）——二者任一出现即返回
      let generated = false, rejected = false;
      try {
        await page.waitForFunction(
          (n) => document.querySelectorAll(".story-item").length > n ||
                (document.querySelector(".toast")?.textContent || "").includes("生成失败"),
          before, { timeout: 90000 }
        );
        generated = await page.evaluate((n) => document.querySelectorAll(".story-item").length > n, before);
        rejected = !generated;
      } catch {}
      step(generated ? "生成新故事成功" : (rejected ? "生成被业务拒绝（新词不足，toast 正常）" : "90s 内无结果"), generated || rejected);
      await page.waitForTimeout(1000);
    }
    const after = await page.locator(".story-item").count();
    step(`故事列表 ${before} → ${after} 篇`, after > 0);

    // 3. 打开第一篇
    await page.locator(".story-item-main").first().click();
    await page.waitForTimeout(800);
    step("故事阅读页打开", await page.locator(".story-read-content").isVisible().catch(() => false));
    const swCount = await page.locator(".sw, .story-clickable-word").count();
    step(`故事里有 ${swCount} 个可点词`, swCount > 0);

    // 4. 点词弹面板
    await page.locator(".sw, .story-clickable-word").first().click();
    await page.waitForTimeout(600);
    step("点词弹出查词面板", await page.locator(".story-word-panel").isVisible().catch(() => false));
    const pw = (await page.locator(".story-word-panel-word").textContent().catch(() => "")).trim();
    step(`面板单词：${pw}`, pw.length > 0);

    // 5. 面板内评分（已入库的词出现评分按钮；未入库则出现「添加到词库」）
    const rateBtn = page.locator(".story-word-panel .btn-rating.rating-3");
    if (await rateBtn.isVisible().catch(() => false)) {
      await rateBtn.click();
      await page.waitForTimeout(800);
      // 评分成功后面板自动关闭 + toast 提示（既有设计：评完即走）
      step("评分提交后面板自动关闭", !(await page.locator(".story-word-panel").isVisible().catch(() => false)));
      step("评分 toast 出现", await page.locator(".toast").isVisible().catch(() => false));
    } else {
      const addBtn = page.getByText("添加到词库", { exact: false });
      step("未学词显示「加入词库」入口", await addBtn.isVisible().catch(() => false));
    }

    // 6. 中英模式切换（若抽屉还开着先关掉：遮罩会挡住页面交互）
    if (await page.locator(".story-word-panel").isVisible().catch(() => false)) {
      await page.locator(".story-word-panel-close").click();
      await page.waitForTimeout(400);
    }
    await page.locator(".mode-btn", { hasText: "中英" }).click();
    await page.waitForTimeout(400);
    step("切换中英对照模式", await page.locator(".story-pair").first().isVisible().catch(() => false));

    await page.screenshot({ path: "e2e_story.png" });
  } catch (e) {
    console.log("❌ 中断:", e.message);
    await page.screenshot({ path: "e2e_story_failure.png", fullPage: true });
  }

  console.log("\n--- 控制台错误 ---");
  console.log(errors.length ? errors.join("\n") : "（无）");
  await browser.close();
})();
