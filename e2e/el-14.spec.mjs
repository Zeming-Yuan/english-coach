import {test, expect} from './support/test.mjs';

async function openScene(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  await expect(page.getByRole('button', {name: '买饮品', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '买饮品', exact: true}).click();
}
async function submit(page, text) {
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill(text);
  await scene.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(scene).toContainText('已保存');
}

test('EL-14 independent three-turn drink task shows separate application evidence', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'water', meaning: '水', example: 'Water is good.'}]);
  await openScene(app, page);
  const scene = page.getByTestId('scene-session');
  await expect(scene).toContainText('买饮品');
  await expect(scene).not.toContainText('Can I have');
  for (const text of ['Can I have water, please?', 'One cup, please.', 'Yes, thank you.']) {
    await submit(page, text);
    await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
  }
  await expect(scene).toContainText('本场景独立通过');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts).toHaveLength(3);
  expect(backup.learning_events).toEqual([]);
  expect(backup.reviews).toEqual([]);
  await page.screenshot({path: test.info().outputPath('drink-scene-result.png'), fullPage: true});
});

for (const failure of ['commit', 'response-loss']) {
  test(`EL-14 ${failure} answer refresh confirms the same response once`, async ({appFactory, page}) => {
    const app = await appFactory();
    await openScene(app, page);
    const scene = page.getByTestId('scene-session');
    await submit(page, 'Can I have water, please?');
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
    if (failure === 'commit') await app.failCommitOnce();
    else await page.route('**/api/practice-sessions/*/items/*/attempts', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill('One cup, please.');
    await scene.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(scene.getByRole('button', {name: '继续确认保存', exact: true})).toBeVisible();
    await expect(scene).toContainText('已处理 1/3');
    const pending = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('ec.pending.scene:')).map(([,v]) => JSON.parse(v))[0]);
    await openScene(app, page);
    await expect(scene.getByRole('textbox', {name: '你的答案', exact: true})).toHaveValue('One cup, please.');
    await scene.getByRole('button', {name: '继续确认保存', exact: true}).click();
    await expect(scene).toContainText('已处理 2/3');
    const saved = await (await app.request.get('/api/export/backup')).json();
    expect(saved.extensions.scene_attempts.filter(a => a.submission_id === pending.payload.submission_id)).toHaveLength(1);
    expect(saved.learning_events).toEqual([]);
  });

  test(`EL-14 ${failure} creation refresh confirms the same scene once`, async ({appFactory, page}) => {
    const app = await appFactory();
    await page.goto(app.baseURL);
    await page.getByRole('button', {name: '场景练习', exact: true}).click();
    await expect(page.getByRole('button', {name: '买饮品', exact: true})).toBeVisible();
    if (failure === 'commit') await app.failCommitOnce();
    else await page.route('**/api/practice-sessions', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
    await page.getByRole('button', {name: '买饮品', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('场景尚未确认保存');
    await page.reload();
    await page.getByRole('button', {name: '场景练习', exact: true}).click();
    await page.getByRole('button', {name: '继续确认保存', exact: true}).click();
    await expect(page.getByTestId('scene-session')).toContainText('第 1/3 轮');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.practice_sessions).toHaveLength(1);
  });
}

test('EL-14 unknown rejected retry and skip never become independent', async ({appFactory, page}) => {
  const app = await appFactory();
  await openScene(app, page);
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(scene.getByRole('alert')).toContainText('请继续输入');
  await submit(page, 'water');
  await expect(scene).toContainText('规则明确不满足');
  await scene.getByRole('button', {name: '再练本轮', exact: true}).click();
  await submit(page, 'Can I have water, please?');
  await expect(scene).toContainText('再练结果，首答不变');
  await scene.getByRole('button', {name: '下一轮', exact: true}).click();
  await submit(page, 'A single glass would be lovely.');
  await expect(scene).toContainText('未判定');
  await scene.getByRole('button', {name: '下一轮', exact: true}).click();
  await scene.getByRole('button', {name: '跳过本轮', exact: true}).click();
  await expect(scene).toContainText('显式跳过');
  await scene.getByRole('button', {name: '查看结果', exact: true}).click();
  await expect(scene).toContainText('本次流程完成');
  await expect(scene).toContainText('本场景尚未独立通过');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts).toHaveLength(4);
  expect(backup.extensions.scene_attempts.map(a => a.verdict)).toEqual(['rejected', 'accepted', 'unknown', 'unknown']);
});

test('EL-14 assistance survives refresh and TTS failure keeps the saved result', async ({appFactory, page}) => {
  await page.addInitScript(() => {delete window.speechSynthesis;});
  const app = await appFactory({fixture: 'ec16-tts-error.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('button', {name: '查看标准表达', exact: true}).click();
  await expect(scene).toContainText('Can I have water, please?');
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.length).toBeGreaterThan(0);
  await openScene(app, page);
  await expect(scene).toContainText('持续按辅助记录');
  await scene.getByRole('button', {name: '朗读标准表达', exact: true}).click();
  await expect(scene).toContainText('语音暂不可用');
  for (const text of ['Can I have water, please?', 'One cup, please.', 'Yes, thank you.']) {
    await submit(page, text);
    await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
  }
  await expect(scene).toContainText('本场景尚未独立通过');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts[0].assistance).toContain('answer_visible');
  expect(backup.extensions.scene_attempts).toHaveLength(3);
});

test('EL-14 V3 browser restore resumes the original tasks and help', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  await submit(page, 'Can I have water, please?');
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('button', {name: '下一轮', exact: true}).click();
  await scene.getByRole('button', {name: '任务提示', exact: true}).click();
  await expect(scene).toContainText('提示：');
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '备份与恢复', exact: true}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: '下载完整备份', exact: true}).click();
  const file = await (await downloading).path();
  const target = await appFactory();
  await target.seedCards([{word: 'retired', meaning: '旧词'}]);
  await page.goto(target.baseURL);
  await page.getByRole('button', {name: '设置', exact: true}).click();
  await page.getByRole('button', {name: '备份与恢复', exact: true}).click();
  await page.getByLabel('选择备份文件').setInputFiles(file);
  await page.getByRole('button', {name: '确认替换学习数据', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('恢复成功');
  await openScene(target, page);
  await expect(scene).toContainText('第 2/3 轮');
  await expect(scene).toContainText('持续按辅助记录');
  await submit(page, 'One cup, please.');
  const backup = await (await target.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts).toHaveLength(2);
  expect(backup.cards[0].id).not.toBe(1);
});

for (const change of ['revision', 'deletion']) {
  test(`EL-14 ${change} rejects stale input and preserves historical answers`, async ({appFactory, page}) => {
    const app = await appFactory();
    const [id] = await app.seedCards([{word: 'water', meaning: '水'}]);
    await openScene(app, page);
    const scene = page.getByTestId('scene-session');
    await submit(page, 'Can I have water, please?');
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
    const changed = change === 'revision' ? await app.request.put(`/api/cards/${id}`, {data: {meaning: '清水'}}) : await app.request.delete(`/api/cards/${id}`);
    expect(changed.ok()).toBeTruthy();
    await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill('one');
    await scene.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(scene.getByRole('alert')).toContainText(change === 'revision' ? '修订' : '删除');
    await scene.getByRole('button', {name: '放弃这条待确认', exact: true}).click();
    await expect(scene).toContainText(change === 'revision' ? '修订' : '删除');
    await scene.getByRole('button', {name: '新开一轮', exact: true}).click();
    await expect(scene).toContainText('第 1/3 轮');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(1);
  });
}

test('EL-14 rollback hides new entry and preserves restored historical evidence', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  for (const text of ['Can I have water, please?', 'one', 'Yes, thank you.']) {
    await submit(page, text);
    await page.getByTestId('scene-session').getByRole('button', {name: /下一轮|查看结果/}).click();
  }
  const backup = await (await app.request.get('/api/export/backup')).json();
  const target = await appFactory({fixture: 'el14-disabled.json'});
  const preview = await target.request.post('/api/import/preview', {data: backup});
  expect(preview.ok()).toBeTruthy();
  expect((await target.request.post('/api/import/cards', {data: {backup, expected_revision: (await preview.json()).expected_revision}})).ok()).toBeTruthy();
  await page.goto(target.baseURL);
  await expect(page.getByText('今天的学习', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '场景练习', exact: true})).toHaveCount(0);
  const run = backup.extensions.practice_sessions[0];
  expect((await target.request.get(`/api/practice-sessions/${run.session_id}`)).ok()).toBeTruthy();
  expect((await target.request.post('/api/practice-sessions', {data: {id: crypto.randomUUID(), purpose: 'scene', scene_id: 'drinks'}})).status()).toBe(403);
  await page.getByRole('button', {name: /单词本/}).click();
  await page.locator('.word-item', {hasText: 'water'}).first().click();
  await expect(page.getByTestId('learning-evidence')).toContainText('历史应用证据');
  expect((await (await target.request.get('/api/export/backup')).json()).extensions.scene_attempts).toHaveLength(3);
});

test('EL-14 preparation keeps English answers hidden before starting', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  const preparation = page.getByLabel('词汇准备状态');
  await expect(preparation).toContainText('水');
  await expect(preparation).not.toContainText('water');
  await expect(preparation).not.toContainText('one');
});

test('EL-14 successful standard audio records its actual contact time', async ({appFactory, page}) => {
  await page.addInitScript(() => {delete window.speechSynthesis;});
  const app = await appFactory();
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('button', {name: '查看标准表达', exact: true}).click();
  await expect(scene).toContainText('Can I have water, please?');
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.filter(c => c.source === 'scene' && c.kind === 'answer_visible').length).toBe(1);
  const warmed = await app.request.get('/api/tts/audio/' + encodeURIComponent('Can I have water, please?') + '/preload');
  expect((await warmed.json()).cached).toBe(true);
  const beforeAudio = (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts;
  expect(beforeAudio.filter(c => c.kind === 'answer_audio')).toHaveLength(0);
  await app.setTime('2026-10-31T12:00:00Z');
  await scene.getByRole('button', {name: '朗读标准表达', exact: true}).click();
  await expect(scene).toContainText('已播放标准表达');
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.filter(c => c.source === 'scene' && c.kind === 'answer_audio').length).toBe(1);
  const contacts = (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts;
  expect(contacts.find(c => c.kind === 'answer_audio').occurred_at).toContain('2026-10-31');
});
