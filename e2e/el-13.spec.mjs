import {test, expect} from './support/test.mjs';

async function prepare(app, page, start = true) {
  const [id] = await app.seedCards([{word: 'apple', meaning: '苹果'}]);
  for (const now of ['2026-10-01T01:00:00Z', '2026-10-02T02:00:00Z']) {
    await app.setTime(now);
    expect((await app.request.post('/api/typing/check', {data: {
      card_id: id, user_input: 'apple', source: 'spelling', submission_id: crypto.randomUUID(),
    }})).ok()).toBeTruthy();
  }
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '故事', exact: true}).click();
  await page.getByRole('button', {name: '生成新故事', exact: true}).click();
  await page.locator('.story-item-main').click();
  if (start) {
    await expect(page.getByRole('button', {name: '读后检查', exact: true})).toBeVisible();
    await page.getByRole('button', {name: '读后检查', exact: true}).click();
  }
}

test('EL-13 recognition and independent input show separate results', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page);
  await expect(page.getByTestId('practice-session')).toContainText('阅读理解');
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await expect(page.locator('.story-read-content')).toHaveCount(0);
  await expect(page.getByTestId('practice-session')).not.toContainText('apple');
  await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
  await page.getByRole('button', {name: '提交答案', exact: true}).click();
  await page.getByRole('button', {name: '查看结果', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('阅读识别 1 · 词汇独立 1 · 辅助 0');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.learning_events.filter(e => e.source === 'story').map(e => [e.kind, e.scheduled])).toEqual([['choice', false], ['typed', true]]);
  await page.screenshot({path: test.info().outputPath('story-check-result.png'), fullPage: true});
});

for (const failure of ['commit', 'response-loss']) {
  test(`EL-13 ${failure} refresh confirms the original answer once`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el11-stories.json'});
    await prepare(app, page);
    await page.getByRole('button', {name: 'apple', exact: true}).click();
    await page.getByRole('button', {name: '下一题', exact: true}).click();
    if (failure === 'commit') await app.failCommitOnce();
    else await page.route('**/api/practice-sessions/*/items/*/attempts', async route => {
      await route.fetch(); await route.abort('failed');
    }, {times: 1});
    await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
    await page.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(page.getByTestId('practice-session').getByRole('button', {name: '继续确认保存', exact: true})).toBeVisible();
    await page.reload();
    await page.getByRole('button', {name: '故事', exact: true}).click();
    await page.locator('.story-item-main').click();
    const check = page.getByTestId('practice-session');
    await expect(check.getByRole('textbox', {name: '你的答案', exact: true})).toHaveValue('apple');
    await check.getByRole('button', {name: '继续确认保存', exact: true}).click();
    await expect(check).toContainText('已保存');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.learning_events.filter(e => e.source === 'story' && e.kind === 'typed')).toHaveLength(1);
  });
}

test('EL-13 reopening the story keeps typed answer assisted', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page);
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
  await expect(page.locator('.story-read-content')).toBeVisible();
  await page.getByRole('button', {name: '返回检查', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('按辅助记录');
  await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
  await page.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('已保存');
  const backup = await (await app.request.get('/api/export/backup')).json();
  const typed = backup.learning_events.filter(e => e.source === 'story' && e.kind === 'typed');
  expect(typed).toHaveLength(1);
  expect(typed[0].assistance).toContain('answer_visible');
  expect(typed[0].scheduled).toBe(false);
});

async function restore(app, backup) {
  const preview = await app.request.post('/api/import/preview', {data: backup});
  expect(preview.ok(), await preview.text()).toBeTruthy();
  const response = await app.request.post('/api/import/cards', {data: {
    backup, expected_revision: (await preview.json()).expected_revision,
  }});
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function openSavedStory(page, app) {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '故事', exact: true}).click();
  await page.locator('.story-item-main').click();
}

for (const failure of ['commit', 'response-loss']) {
  test(`EL-13 ${failure} creation refresh confirms the same round`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el11-stories.json'});
    await prepare(app, page, false);
    if (failure === 'commit') await app.failCommitOnce();
    else await page.route('**/api/practice-sessions', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await page.getByRole('button', {name: '读后检查', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('检查尚未确认保存');
    await openSavedStory(page, app);
    await page.getByRole('button', {name: '继续确认保存', exact: true}).click();
    await expect(page.getByTestId('practice-session')).toContainText('阅读理解');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.practice_sessions).toHaveLength(1);
  });
}

test('EL-13 V3 another instance resumes assistance and original version', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page);
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await page.getByRole('button', {name: '提示首字母', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('首字母：a');
  const backup = await (await app.request.get('/api/export/backup')).json();
  const target = await appFactory();
  await restore(target, backup);
  await openSavedStory(page, target);
  await expect(page.getByTestId('practice-session')).toContainText(backup.extensions.story_versions[0].version_id);
  await expect(page.getByTestId('practice-session')).toContainText('按辅助记录');
  await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
  await page.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('已保存');
  const after = await (await target.request.get('/api/export/backup')).json();
  expect(after.learning_events.filter(e => e.source === 'story' && e.kind === 'typed').map(e => e.scheduled)).toEqual([false]);
});

for (const mode of ['choice-only', 'typed-only', 'empty']) {
  test(`EL-13 ${mode} version reports actual question count`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el11-stories.json'});
    await prepare(app, page, false);
    if (mode === 'typed-only') {
      // Finish the real reader contact before replacing fixture data; a late contact
      // correctly invalidates the preview revision and is unrelated to this case.
      await page.locator('.story-sentence-en').first().scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const saved = await (await app.request.get('/api/export/backup')).json();
        return saved.extensions.learning_contacts.some(c => c.source === 'story');
      }).toBe(true);
      await page.locator('.reader-toolbar').getByRole('button', {name: '返回故事列表', exact: true}).click();
    }
    const backup = await (await app.request.get('/api/export/backup')).json();
    const id = backup.cards[0].id;
    if (mode === 'choice-only') expect((await app.request.put(`/api/cards/${id}`, {data: {meaning: ''}})).ok()).toBeTruthy();
    else if (mode === 'empty') expect((await app.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    else {
      delete backup.extensions.story_versions[0].material.check;
      backup.extensions.story_versions[0].quality.unknown_forms = [];
      await restore(app, backup);
    }
    await openSavedStory(page, app);
    await page.getByRole('button', {name: '读后检查', exact: true}).click();
    const check = page.getByTestId('practice-session');
    await expect(check).toContainText(`实际 ${mode === 'empty' ? 0 : 1} 题`);
    if (mode === 'empty') await expect(check).toContainText('暂无可用检查题');
    else if (mode === 'choice-only') await expect(check).toContainText('阅读理解');
    else {
      await expect(check).toContainText('词汇输入');
      await expect(check.getByRole('button', {name: 'apple', exact: true})).toHaveCount(0);
    }
  });
}

test('EL-13 legacy story stays readable without invented checks', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'ec04-story.json'});
  await openSavedStory(page, app);
  await expect(page.locator('.story-read-content')).toBeVisible();
  await expect(page.getByText('本篇暂无检查题', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '读后检查', exact: true})).toHaveCount(0);
});

for (const change of ['revision', 'deletion']) {
  test(`EL-13 ${change} rejects a stale answer and returns to the story`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el11-stories.json'});
    await prepare(app, page);
    await page.getByRole('button', {name: 'apple', exact: true}).click();
    await page.getByRole('button', {name: '下一题', exact: true}).click();
    const before = await (await app.request.get('/api/export/backup')).json();
    if (change === 'revision') expect((await app.request.put(`/api/cards/${before.cards[0].id}`, {data: {meaning: '修订释义'}})).ok()).toBeTruthy();
    else expect((await app.request.delete(`/api/stories/${before.stories[0].id}`)).ok()).toBeTruthy();
    await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
    await page.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(page.getByTestId('practice-session').getByRole('alert')).toContainText(/修订|删除|版本/);
    await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
    await expect(page.locator('.story-read-content')).toBeVisible();
    const after = await (await app.request.get('/api/export/backup')).json();
    expect(after.learning_events.filter(e => e.source === 'story' && e.kind === 'typed')).toHaveLength(0);
  });
}

test('EL-13 failed help confirmation keeps the original text hidden', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page);
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await app.failCommitOnce();
  await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('回看帮助尚未确认保存');
  await expect(page.locator('.story-read-content')).toHaveCount(0);
  await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
  await expect(page.locator('.story-read-content')).toBeVisible();
  await page.getByRole('button', {name: '返回检查', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('按辅助记录');
});

test('EL-13 functional rollback hides entry and keeps restored records', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page);
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  const backup = await (await app.request.get('/api/export/backup')).json();
  const target = await appFactory({fixture: 'el13-checks-disabled.json'});
  await restore(target, backup);
  await openSavedStory(page, target);
  // Existing history remains readable; returning to the original text hides the entry.
  await expect(page.getByTestId('practice-session')).toContainText(backup.extensions.story_versions[0].version_id);
  await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
  await expect(page.locator('.story-read-content')).toBeVisible();
  await expect(page.getByRole('button', {name: '返回检查', exact: true})).toHaveCount(0);
  const after = await (await target.request.get('/api/export/backup')).json();
  expect(after.extensions.practice_sessions[0].session_id).toBe(backup.extensions.practice_sessions[0].session_id);
  expect(after.learning_events.filter(e => e.source === 'story')).toHaveLength(1);
});

test('EL-13 stale creation after restore can be abandoned for the imported round', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el11-stories.json'});
  await prepare(app, page, false);
  await page.locator('.story-sentence-en').first().scrollIntoViewIfNeeded();
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.some(c => c.source === 'story')).toBe(true);
  await page.route('**/api/practice-sessions', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
  await page.getByRole('button', {name: '读后检查', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('检查尚未确认保存');
  const backup = await (await app.request.get('/api/export/backup')).json();
  await page.locator('.reader-toolbar').getByRole('button', {name: '返回故事列表', exact: true}).click();
  await restore(app, backup);
  await openSavedStory(page, app);
  await page.getByRole('button', {name: '继续确认保存', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('其他故事');
  await expect(page.getByRole('button', {name: '放弃待确认创建', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '放弃待确认创建', exact: true}).click();
  await page.getByRole('button', {name: '返回检查', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('阅读理解');
  const after = await (await app.request.get('/api/export/backup')).json();
  expect(after.extensions.practice_sessions).toHaveLength(1);
});

for (const kind of ['choice', 'typed']) {
  test(`EL-13 abandoning recovered ${kind} selects the saved next state`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el11-stories.json'});
    await prepare(app, page);
    if (kind === 'typed') {
      await page.getByRole('button', {name: 'apple', exact: true}).click();
      await page.getByRole('button', {name: '下一题', exact: true}).click();
    }
    await page.route('**/api/practice-sessions/*/items/*/attempts', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    if (kind === 'typed') {
      await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
      await page.getByRole('button', {name: '提交答案', exact: true}).click();
    } else await page.getByRole('button', {name: 'apple', exact: true}).click();
    await expect(page.getByTestId('practice-session').getByRole('button', {name: '继续确认保存', exact: true})).toBeVisible();
    await openSavedStory(page, app);
    const check = page.getByTestId('practice-session');
    await check.getByRole('button', {name: '放弃这条待确认', exact: true}).click();
    if (kind === 'choice') {
      await expect(check.getByRole('textbox', {name: '你的答案', exact: true})).toBeVisible();
      await expect(check.getByRole('button', {name: 'apple', exact: true})).toHaveCount(0);
    } else {
      await expect(check).toContainText('阅读识别 1 · 词汇独立 1 · 辅助 0');
      await expect(check.getByRole('textbox', {name: '你的答案', exact: true})).toHaveCount(0);
    }
    const after = await (await app.request.get('/api/export/backup')).json();
    expect(after.learning_events.filter(e => e.source === 'story')).toHaveLength(kind === 'choice' ? 1 : 2);
  });
}

test('EL-13 simpler version checks stay separate when switching versions', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el12-stories.json'});
  await prepare(app, page, false);
  const original = await page.locator('[data-story-version]').getAttribute('data-story-version');
  await page.getByRole('button', {name: '更简单', exact: true}).click();
  await expect(page.getByTestId('story-check-status')).toHaveText('简化版 · 未检查');
  await page.getByRole('button', {name: '读后检查', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('阅读理解');
  await page.getByRole('button', {name: 'apple', exact: true}).click();
  await page.getByRole('button', {name: '下一题', exact: true}).click();
  await expect(page.getByRole('button', {name: '查看原版', exact: true})).toHaveCount(0);
  await page.getByRole('textbox', {name: '你的答案', exact: true}).fill('apple');
  await page.getByRole('button', {name: '提交答案', exact: true}).click();
  await page.getByRole('button', {name: '查看结果', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('阅读识别 1 · 词汇独立 1 · 辅助 0');
  await page.getByRole('button', {name: '← 回看原文', exact: true}).click();
  await expect(page.getByTestId('story-check-status')).toHaveText('简化版 · 已有检查记录');
  await page.getByRole('button', {name: '查看原版', exact: true}).click();
  await expect(page.locator('[data-story-version]')).toHaveAttribute('data-story-version', original);
  await expect(page.getByTestId('story-check-status')).toHaveText('原版 · 未检查');
  await page.getByRole('button', {name: '查看简化版', exact: true}).click();
  await expect(page.getByTestId('practice-session')).toContainText('阅读识别 1 · 词汇独立 1 · 辅助 0');
  await page.reload();
  await page.getByRole('button', {name: '故事', exact: true}).click();
  await expect(page.locator('.story-item-main').filter({hasText: '简化版 · 已有检查记录'})).toHaveCount(1);
  await expect(page.locator('.story-item-main').filter({hasText: '原版 · 未检查'})).toHaveCount(1);
});
