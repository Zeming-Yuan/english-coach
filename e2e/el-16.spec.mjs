import {test, expect} from './support/test.mjs';

async function openScene(app, page, title = '买饮品') {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  await page.getByRole('button', {name: title, exact: true}).click();
}

async function submit(page, text) {
  const scene = page.getByTestId('scene-session');
  await scene.getByRole('textbox', {name: '你的答案', exact: true}).fill(text);
  await scene.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(scene).toContainText('已保存');
  return scene;
}

test('EL-16 saved rule result shows bounded model feedback and visible contact', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-valid.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  const scene = await submit(page, 'Can I have water, please?');
  const feedback = scene.getByTestId('scene-feedback');
  await expect(feedback).toContainText('模型回应');
  await expect(feedback).toContainText('Water is ready.');
  await expect(scene).toContainText('规则认可');
  await feedback.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.length).toBe(1);
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_feedback).toHaveLength(1);
  expect(backup.extensions.scene_attempts).toHaveLength(1);
  expect(backup.learning_events).toEqual([]);
  expect(backup.reviews).toEqual([]);
  await page.screenshot({path: test.info().outputPath('scene-feedback.png'), fullPage: true});
});

for (const scenario of ['empty', 'vocabulary', 'leak', 'context', 'correction']) {
  test(`EL-16 ${scenario} output falls back without changing the saved rule result`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: `el16-${scenario}.json`});
    await openScene(app, page);
    const scene = await submit(page, 'Can I have water, please?');
    const feedback = scene.getByTestId('scene-feedback');
    await expect(feedback).toContainText('核对模板');
    await expect(feedback).toContainText('Water is ready.');
    await expect(scene).toContainText('规则认可');
    await scene.getByRole('button', {name: '下一轮', exact: true}).click();
    await expect(scene).toContainText('第 2/3 轮');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(1);
    expect(backup.extensions.scene_feedback[0].origin).toBe('template');
    expect(backup.learning_events).toEqual([]);
    expect(backup.reviews).toEqual([]);
  });
}

for (const scenario of ['missing', 'timeout', 'unavailable']) {
  test(`EL-16 ${scenario} AI keeps the three-turn template path usable`, async ({appFactory, page}) => {
    const app = await appFactory(scenario === 'missing' ? {} : {fixture: `ec01-${scenario}.json`});
    await openScene(app, page);
    const scene = page.getByTestId('scene-session');
    for (const text of ['Can I have water, please?', 'One cup, please.', 'Yes, thank you.']) {
      await submit(page, text);
      await expect(scene.getByTestId('scene-feedback').last()).toContainText('核对模板');
      await scene.getByRole('button', {name: /下一轮|查看结果/}).click();
    }
    await expect(scene).toContainText('本场景独立通过');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_attempts).toHaveLength(3);
    expect(backup.extensions.scene_feedback).toHaveLength(3);
    expect(backup.extensions.scene_feedback.every(f => f.origin === 'template')).toBe(true);
    expect(backup.learning_events).toEqual([]);
    expect(backup.reviews).toEqual([]);
  });
}

test('EL-16 model grading instructions keep unknown answers unknown', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-unknown.json'});
  await openScene(app, page);
  const scene = await submit(page, 'I want water, please');
  await expect(scene).toContainText('未判定');
  await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
  await expect(scene.getByTestId('scene-feedback')).toContainText('Let us try again.');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts[0].verdict).toBe('unknown');
  expect(backup.extensions.practice_items.filter(i => i.first_task_attempt_id)).toHaveLength(1);
  expect(backup.learning_events).toEqual([]);
});

for (const failure of ['commit', 'response-loss']) {
  test(`EL-16 feedback ${failure} refresh confirms the original operation once`, async ({appFactory, page}) => {
    const app = await appFactory();
    await page.route('**/api/practice-sessions/*/items/*/feedback', async route => {
      if (failure === 'commit') await app.failCommitOnce();
      const response = await route.fetch();
      if (failure === 'response-loss') await route.abort('failed');
      else await route.fulfill({response});
    }, {times: 1});
    await openScene(app, page);
    const scene = await submit(page, 'Can I have water, please?');
    await expect(scene.getByTestId('scene-feedback').getByRole('alert')).toContainText('反馈尚未确认');
    const pending = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('ec.feedback.')).map(([,v]) => JSON.parse(v))[0]);
    expect(pending.payload.operation_id).toBeTruthy();
    await expect(scene).toContainText('已处理 1/3');
    await openScene(app, page);
    await expect(scene).toContainText('第 2/3 轮');
    await scene.getByText('第 1 轮首答与反馈', {exact: false}).click();
    await expect(scene.getByTestId('scene-feedback')).toContainText('核对模板');
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_feedback).toHaveLength(1);
    expect(backup.extensions.scene_feedback[0].operation_id).toBe(pending.payload.operation_id);
    expect(backup.extensions.scene_attempts).toHaveLength(1);
    expect(backup.learning_events).toEqual([]);
  });
}

for (const destination of ['next-turn', 'another-scene']) {
  test(`EL-16 late feedback stays with its original item after ${destination}`, async ({appFactory, page}) => {
    const app = await appFactory({fixture: 'el16-valid.json'});
    await app.seedCards([{word: 'water', meaning: '水'}]);
    let ready, release;
    const started = new Promise(resolve => {ready = resolve;});
    const wait = new Promise(resolve => {release = resolve;});
    await page.route('**/api/practice-sessions/*/items/*/feedback', async route => {
      const response = await route.fetch();
      ready(); await wait; await route.fulfill({response});
    }, {times: 1});
    await openScene(app, page);
    const scene = await submit(page, 'Can I have water, please?');
    await started;
    try {
      await expect(scene.getByTestId('scene-feedback')).toContainText('正在生成');
      if (destination === 'next-turn') {
        await scene.getByRole('button', {name: '下一轮', exact: true}).click();
        await expect(scene).toContainText('第 2/3 轮');
      } else {
        await scene.getByRole('button', {name: '返回场景列表', exact: true}).click();
        await page.getByRole('button', {name: '自我介绍', exact: true}).click();
        await expect(scene).toContainText('自我介绍');
        await expect(scene).toContainText('已处理 0/3');
      }
    } finally {release();}
    if (destination === 'next-turn') {
      await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
      await expect(scene.getByTestId('scene-feedback')).toBeHidden();
      await expect(scene.getByRole('textbox', {name: '你的答案', exact: true})).toHaveValue('');
    } else await expect(scene.getByTestId('scene-feedback')).toHaveCount(0);
    const backup = await (await app.request.get('/api/export/backup')).json();
    expect(backup.extensions.scene_feedback).toHaveLength(1);
    expect(backup.extensions.scene_attempts).toHaveLength(1);
    expect(backup.extensions.learning_contacts).toHaveLength(0);
  });
}

test('EL-16 visible feedback contact response loss retries the same contact', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-valid.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await page.route('**/api/learning/contacts', async route => {await route.fetch(); await route.abort('failed');}, {times: 1});
  await openScene(app, page);
  const scene = await submit(page, 'Can I have water, please?');
  const feedback = scene.getByTestId('scene-feedback');
  await expect(feedback).toContainText('模型回应');
  await feedback.scrollIntoViewIfNeeded();
  await expect(feedback.getByRole('alert')).toContainText('反馈接触依据尚未确认');
  const pending = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('ec.contact.')).map(([,v]) => JSON.parse(v))[0]);
  await feedback.getByRole('button', {name: '继续确认接触', exact: true}).click();
  await expect(feedback.getByRole('alert')).toHaveCount(0);
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.learning_contacts).toHaveLength(1);
  expect(backup.extensions.learning_contacts[0].submission_id).toBe(pending.payload.submission_id);
  expect(backup.extensions.learning_contacts[0].source).toBe('scene');
});

test('EL-16 V3 browser restore preserves feedback origin and continues saved tasks', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-valid.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openScene(app, page);
  const scene = await submit(page, 'Can I have water, please?');
  await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
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
  await scene.getByText('第 1 轮首答与反馈', {exact: false}).click();
  await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
  await expect(scene.getByTestId('scene-feedback')).toContainText('Water is ready.');
  await submit(page, 'One cup, please.');
  const backup = await (await target.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_attempts).toHaveLength(2);
  expect(backup.extensions.scene_feedback[0].origin).toBe('model');
  expect(backup.learning_events).toEqual([]);
});

test('EL-16 enhancement rollback keeps saved model replies and new template feedback', async ({appFactory, page}) => {
  const original = await appFactory({fixture: 'el16-valid.json'});
  await openScene(original, page);
  const scene = await submit(page, 'Can I have water, please?');
  await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
  const app = await appFactory({snapshotOf: original.databasePath, fixture: 'el16-disabled.json'});
  await openScene(app, page);
  await scene.getByText('第 1 轮首答与反馈', {exact: false}).click();
  await expect(scene.getByTestId('scene-feedback')).toContainText('模型回应');
  await submit(page, 'One cup, please.');
  await expect(scene.getByTestId('scene-feedback').last()).toContainText('核对模板');
  const backup = await (await app.request.get('/api/export/backup')).json();
  expect(backup.extensions.scene_feedback.map(row => row.origin)).toEqual(['model', 'template']);
  expect(backup.extensions.scene_attempts).toHaveLength(2);
  expect((await app.request.post('/api/import/preview', {data: backup})).ok()).toBe(true);
});

test('EL-16 feedback title visibility does not count offscreen response words', async ({appFactory, page}) => {
  const viewport = page.viewportSize();
  await page.setViewportSize({...viewport, height: viewport.height - 120});
  const app = await appFactory({fixture: 'el16-valid.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  let ready, release;
  const started = new Promise(resolve => {ready = resolve;});
  const wait = new Promise(resolve => {release = resolve;});
  await page.route('**/api/practice-sessions/*/items/*/feedback', async route => {
    const response = await route.fetch(); ready(); await wait; await route.fulfill({response});
  }, {times: 1});
  await openScene(app, page);
  const scene = await submit(page, 'Can I have water, please?');
  await started;
  const feedback = scene.getByTestId('scene-feedback');
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
  } finally {release();}
  await expect(feedback).toContainText('模型回应');
  await feedback.getByRole('status').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight - 2));
  const words = feedback.getByText('Water is ready.', {exact: true});
  const geometry = await words.evaluate(el => ({top: el.getBoundingClientRect().top, height: window.innerHeight, scroll: window.scrollY, header: el.previousElementSibling.getBoundingClientRect().bottom}));
  expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.height);
  // Give the visibility observer and an erroneous contact request time to settle.
  await page.waitForTimeout(300);
  expect((await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts).toHaveLength(0);
  await words.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.length).toBe(1);
});

test('EL-16 leaving after visible feedback still confirms its delayed contact lookup', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-valid.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  let armed = false, ready, release;
  const started = new Promise(resolve => {ready = resolve;});
  const wait = new Promise(resolve => {release = resolve;});
  await page.route('**/api/practice-sessions/*/items/*/feedback', async route => {armed = true; await route.continue();});
  await page.route('**/api/cards', async route => {
    if (!armed) {await route.continue(); return;}
    const response = await route.fetch(); ready(); await wait; await route.fulfill({response});
  });
  await openScene(app, page);
  const scene = await submit(page, 'Can I have water, please?');
  const feedback = scene.getByTestId('scene-feedback');
  await expect(feedback).toContainText('模型回应');
  await feedback.getByText('Water is ready.', {exact: true}).scrollIntoViewIfNeeded();
  await started;
  try {
    expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('ec.contact.lookup:scene-feedback:')))).toBe(true);
    await scene.getByRole('button', {name: '返回场景列表', exact: true}).click();
  } finally {release();}
  await expect.poll(async () => (await (await app.request.get('/api/export/backup')).json()).extensions.learning_contacts.length).toBe(1);
  await expect(page.getByTestId('scene-feedback')).toHaveCount(0);
});
