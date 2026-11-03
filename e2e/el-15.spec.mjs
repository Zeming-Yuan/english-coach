import {test, expect} from './support/test.mjs';

const cases = [
  {id: 'introduction', title: '自我介绍', word: 'tea', answers: ['My name is 李', 'I am from 北京', 'I like tea.']},
  {id: 'directions', title: '问路', word: 'station', answers: ['Excuse me, where is the station?', 'Should I turn left?', 'Yes, thank you.']},
];
async function openScene(app, page, title) {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  await page.getByRole('button', {name: title, exact: true}).click();
}
async function submit(page, text) {
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill(text);
  await scene.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(scene).toContainText('已保存');
}
for (const item of cases) {
  test(`EL-15 ${item.id} independent three-turn result stays in its context`, async ({appFactory, page}) => {
    const app = await appFactory();
    await app.seedCards([{word: item.word, meaning: '场景目标'}]);
    await openScene(app, page, item.title);
    const scene = page.getByTestId('scene-session');
    await expect(scene).toContainText(item.title);
    await expect(scene).not.toContainText(item.answers[0]);
    if (item.id === 'directions') await expect(scene).toContainText('虚构');
    for (const text of item.answers) {
      await submit(page, text);
      await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
    }
    await expect(scene).toContainText('本场景独立通过');
    await expect(scene).toContainText('指定语境应用已有证据');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(3);
    expect(backup.extensions.scene_attempts.flatMap(a => a.target_mapping).map(t => t.context)).toEqual([item.id === 'introduction' ? 'introduction:meeting-over-tea' : 'directions:fictional-station-left']);
    expect(backup.learning_events).toEqual([]);
    expect(backup.reviews).toEqual([]);
    await page.screenshot({path: test.info().outputPath(`${item.id}-result.png`), fullPage: true});
  });
}

test('EL-15 application outcomes remain separate across scene contexts', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'thank', meaning: '感谢'}]);
  for (const [title, answers] of [
    ['买饮品', ['Can I have water, please?', 'one', 'Yes, thank you.']],
    ['问路', ['Excuse me, where is the station?', 'Should I turn left?', 'no']],
  ]) {
    await openScene(app, page, title);
    for (const text of answers) {
      await submit(page, text);
      await page.getByTestId('scene-session').getByRole('button', {name: /下一轮|查看结果/}).click();
    }
  }
  await page.getByRole('button', {name: '返回场景列表', exact: true}).click();
  await page.getByRole('button', {name: '返回队列', exact: true}).click();
  await page.getByRole('button', {name: /单词本/}).click();
  await page.locator('.word-item', {hasText: 'thank'}).first().click();
  const evidence = page.getByTestId('learning-evidence');
  await expect(evidence).toContainText('买饮品 · drinks-v1：指定语境应用已有证据');
  await expect(evidence).toContainText('问路 · directions-v1：指定语境仍需巩固');
});

test('EL-15 expansion rollback keeps drinks and original history available', async ({appFactory, page}) => {
  const app = await appFactory();
  await openScene(app, page, '自我介绍');
  await submit(page, 'My name is 李');
  const backup = await (await app.request.get('/api/export/backup')).json();
  const target = await appFactory({fixture: 'el15-disabled.json'});
  await page.goto(target.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  await expect(page.getByRole('button', {name: '买饮品', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '自我介绍', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '问路', exact: true})).toHaveCount(0);
  const preview = await target.request.post('/api/import/preview', {data: backup});
  expect(preview.ok()).toBeTruthy();
  expect((await target.request.post('/api/import/cards', {data: {backup, expected_revision: (await preview.json()).expected_revision}})).ok()).toBeTruthy();
  await openScene(target, page, '自我介绍');
  const scene = page.getByTestId('scene-session');
  await expect(scene).toContainText('第 2/3 轮');
  for (const text of ['I am from 北京', 'I like tea.']) {
    await submit(page, text);
    await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
  }
  await expect(scene.getByRole('button', {name: '新开一轮', exact: true})).toHaveCount(0);
  expect((await (await target.request.get('/api/export/backup')).json()).extensions.scene_attempts).toHaveLength(3);
});

for (const item of cases) {
  for (const failure of ['commit', 'response-loss']) {
    test(`EL-15 ${item.id} ${failure} creation and answer resume with original identities`, async ({appFactory, page}) => {
      const app = await appFactory();
      const failOnce = async pattern => {
        if (failure === 'commit') await app.failCommitOnce();
        else await page.route(pattern, async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
      };
      await page.goto(app.baseURL);
      await page.getByRole('button', {name: '场景练习', exact: true}).click();
      await expect(page.getByRole('button', {name: item.title, exact: true})).toBeVisible();
      await failOnce('**/api/practice-sessions');
      await page.getByRole('button', {name: item.title, exact: true}).click();
      await expect(page.getByRole('alert')).toContainText('场景尚未确认保存');
      const creation = await page.evaluate(() => JSON.parse(localStorage.getItem('ec.context.scene:create')));
      await page.reload();
      await page.getByRole('button', {name: '场景练习', exact: true}).click();
      await page.getByRole('button', {name: '继续确认保存', exact: true}).click();
      const scene = page.getByTestId('scene-session');
      await expect(scene).toContainText(item.title);
      await failOnce('**/api/practice-sessions/*/items/*/attempts');
      await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill(item.answers[0]);
      await scene.getByRole('button', {name: '提交答案', exact: true}).click();
      await expect(scene.getByRole('button', {name: '继续确认保存', exact: true})).toBeVisible();
      const pending = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('ec.pending.scene:')).map(([, value]) => JSON.parse(value))[0]);
      await openScene(app, page, item.title);
      await expect(scene.getByRole('textbox', {name: '你的答案', exact: true})).toHaveValue(item.answers[0]);
      await scene.getByRole('button', {name: '继续确认保存', exact: true}).click();
      await expect(scene).toContainText('已处理 1/3');
      const backup = await (await app.request.get('/api/export/backup')).json();
      expect(backup.extensions.practice_sessions.map(s => s.session_id)).toEqual([creation.payload.id]);
      expect(backup.extensions.scene_attempts.filter(a => a.submission_id === pending.payload.submission_id)).toHaveLength(1);
      expect(backup.extensions.scene_attempts).toHaveLength(1);
    });
  }

  test(`EL-15 ${item.id} unknown help retry and skip preserve first results`, async ({appFactory, page}) => {
    const app = await appFactory();
    await openScene(app, page, item.title);
    const scene = page.getByTestId('scene-session');
    await scene.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(scene.getByRole('alert')).toContainText('请继续输入');
    await submit(page, item.id === 'introduction' ? 'My name is 123' : 'Could you point me to the station?');
    await expect(scene).toContainText('未判定');
    await scene.getByRole('button', {name: '再练本轮', exact: true}).click();
    await submit(page, item.answers[0]);
    await expect(scene).toContainText('再练结果，首答不变');
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
    await scene.getByRole('button', {name: '任务提示', exact: true}).click();
    await openScene(app, page, item.title);
    await expect(scene).toContainText('持续按辅助记录');
    if (item.id === 'directions') {
      await submit(page, 'Should I turn left or right?');
      await expect(scene).toContainText('未判定');
    } else await submit(page, item.answers[1]);
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
    await scene.getByRole('button', {name: '跳过本轮', exact: true}).click();
    await scene.getByRole('button', {name: '查看结果', exact: true}).click();
    await expect(scene).toContainText('本场景尚未独立通过');
    await expect(scene).toContainText('显式跳过');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(4);
    expect(backup.extensions.scene_attempts[0].verdict).toBe('unknown');
  });

  test(`EL-15 ${item.id} V3 browser restore continues original tasks`, async ({appFactory, page}) => {
    const app = await appFactory();
    await app.seedCards([{word: item.word, meaning: '目标'}]);
    await openScene(app, page, item.title);
    await submit(page, item.answers[0]);
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
    await openScene(target, page, item.title);
    const scene = page.getByTestId('scene-session');
    await expect(scene).toContainText('第 2/3 轮');
    for (const text of item.answers.slice(1)) {
      await submit(page, text);
      await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
    }
    await expect(scene).toContainText('本场景独立通过');
    const backup = await (await target.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(3);
    expect(backup.cards[0].id).not.toBe(1);
  });

  for (const change of ['revision', 'deletion']) {
    test(`EL-15 ${item.id} ${change} stops stale answers and keeps history`, async ({appFactory, page}) => {
      const app = await appFactory();
      const [id] = await app.seedCards([{word: item.word, meaning: '目标'}]);
      await openScene(app, page, item.title);
      await submit(page, item.answers[0]);
      const scene = page.getByTestId('scene-session');
      await scene.getByRole('button', {name: '下一轮', exact: true}).click();
      const changed = change === 'revision' ? await app.request.put(`/api/cards/${id}`, {data: {meaning: '修订'}}) : await app.request.delete(`/api/cards/${id}`);
      expect(changed.ok()).toBeTruthy();
      await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill(item.answers[1]);
      await scene.getByRole('button', {name: '提交答案', exact: true}).click();
      await expect(scene.getByRole('alert')).toContainText(change === 'revision' ? '修订' : '删除');
      await scene.getByRole('button', {name: '放弃这条待确认', exact: true}).click();
      await expect(scene).toContainText('已处理 1/3');
      await expect(scene.getByRole('textbox', {name: '你的答案', exact: true})).toBeDisabled();
      expect((await (await app.request.get('/api/export/backup')).json()).extensions.scene_attempts).toHaveLength(1);
    });
  }
}

test('EL-15 switching scenes resumes each saved task without crossing contexts', async ({appFactory, page}) => {
  const app = await appFactory();
  await openScene(app, page, '自我介绍');
  await submit(page, 'My name is 李');
  await page.getByRole('button', {name: '返回场景列表', exact: true}).click();
  await page.getByRole('button', {name: '问路', exact: true}).click();
  await expect(page.getByTestId('scene-session')).toContainText('第 1/3 轮');
  await page.getByRole('button', {name: '返回场景列表', exact: true}).click();
  await page.getByRole('button', {name: '自我介绍', exact: true}).click();
  await expect(page.getByTestId('scene-session')).toContainText('第 2/3 轮');
  await expect(page.getByRole('button', {name: '新开一轮', exact: true})).toHaveCount(0);
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(new Set(backup.extensions.practice_sessions.map(s => s.scene_id))).toEqual(new Set(['introduction', 'directions']));
});

test('EL-15 preparation hides English answers separately for all three scenes', async ({appFactory, page}) => {
  const app = await appFactory();
  await app.seedCards([{word: 'tea', meaning: '茶'}, {word: 'left', meaning: '左边'}]);
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  for (const title of ['买饮品', '自我介绍', '问路']) {
    const section = page.locator('article').filter({has: page.getByRole('button', {name: title, exact: true})});
    await expect(section.getByLabel('词汇准备状态')).toBeVisible();
    await expect(section).not.toContainText(/I like tea|Should I turn left|Can I have water/);
    await expect(section.getByLabel('词汇准备状态')).not.toContainText(/tea|left|water/);
  }
});

test('EL-15 standard expression and failed speech preserve assisted evidence', async ({appFactory, page}) => {
  await page.addInitScript(() => {delete window.speechSynthesis;});
  const app = await appFactory({fixture: 'ec16-tts-error.json'});
  await app.seedCards([{word: 'tea', meaning: '茶'}]);
  await openScene(app, page, '自我介绍');
  const scene = page.getByTestId('scene-session');
  for (const text of ['My name is 李', 'I am from 北京']) {
    await submit(page, text);
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
  }
  await scene.getByRole('button', {name: '查看标准表达', exact: true}).click();
  await expect(scene).toContainText('I like tea.');
  await scene.getByRole('button', {name: '朗读标准表达', exact: true}).click();
  await expect(scene).toContainText('语音暂不可用');
  await submit(page, 'I like tea.');
  await scene.getByRole('button', {name: '查看结果', exact: true}).click();
  await expect(scene).toContainText('本场景尚未独立通过');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts).toHaveLength(3);
  expect(backup.extensions.scene_attempts[2].assistance).toContain('answer_visible');
  expect(backup.extensions.learning_contacts.some(c => c.source === 'scene' && c.kind === 'answer_visible')).toBe(true);
});
