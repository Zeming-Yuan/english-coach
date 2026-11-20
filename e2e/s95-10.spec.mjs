import {test, expect} from './support/test.mjs';

async function openCatalog(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
}

const sceneCard = (page, name = '买饮品') => page.getByRole('article', {name, exact: true});
const studyButton = (page, name) => sceneCard(page, name).getByRole('button', {name: '先学本场景用词', exact: true});

async function backup(app) {
  const response = await app.request.get('/api/export/backup');
  expect(response.ok()).toBe(true);
  const {exported_at, ...data} = await response.json();
  return data;
}

test('S95-10 prepare missing words and return without creating cards', async ({app, page}) => {
  const before = await backup(app);
  await openCatalog(app, page);
  const study = studyButton(page);
  await expect(study).toBeVisible();
  expect(await backup(app)).toEqual(before);
  await study.click();

  const preparation = page.getByTestId('scene-vocabulary');
  await expect(preparation).toContainText('water');
  await expect(preparation).not.toContainText('Water is cold.');
  await preparation.getByRole('button', {name: '查看释义', exact: true}).click();
  await expect(preparation).toContainText('水');
  await expect(preparation).toContainText('Water is cold.');
  await preparation.getByRole('button', {name: '下一词', exact: true}).click();
  await expect(preparation.getByRole('heading', {name: 'one', exact: true})).toBeVisible();
  await preparation.getByRole('button', {name: '返回买饮品', exact: true}).click();
  await expect(study).toBeFocused();
  expect(await backup(app)).toEqual(before);

  await sceneCard(page).getByRole('button', {name: '直接挑战', exact: true}).click();
  const run = page.getByTestId('scene-session');
  await expect(run).toContainText('第 1/3 轮');
  await expect(run).toContainText('已处理 0/3');
  await expect(run).not.toContainText('Can I have water, please?');
});

test('S95-10 current revision contact is confirmed only after reveal', async ({app, page}) => {
  const [id] = await app.seedCards([{word: 'water', meaning: '旧释义'}]);
  const updated = await app.request.put(`/api/cards/${id}`, {
    data: {meaning: '我自己的水义', example: 'We need more water.'},
  });
  expect(updated.ok()).toBe(true);
  const card = await (await app.request.get(`/api/cards/${id}`)).json();
  const before = await backup(app);
  await openCatalog(app, page);
  await studyButton(page).click();

  const preparation = page.getByTestId('scene-vocabulary');
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toBeVisible();
  await expect(preparation).not.toContainText('我自己的水义');
  expect(await backup(app)).toEqual(before);

  await preparation.getByRole('button', {name: '查看释义', exact: true}).click();
  await expect(preparation).toContainText('我自己的水义');
  await expect(preparation).toContainText('We need more water.');
  await expect.poll(async () => (await backup(app)).extensions.learning_contacts, {timeout: 4000})
    .toEqual([expect.objectContaining({
      card_id: id,
      card_identity: card.content_revision.identity,
      card_revision: card.content_revision.version,
      source: 'scene',
      kind: 'answer_visible',
    })]);
  const after = await backup(app);
  expect(after.cards).toEqual(before.cards);
  expect(after.learning_events).toEqual([]);
  expect(after.reviews).toEqual([]);
  expect(after.extensions.scene_attempts).toEqual([]);
});

test('S95-10 failed audio leaves preparation usable', async ({appFactory, page}) => {
  await page.addInitScript(() => {delete window.speechSynthesis;});
  const app = await appFactory({fixture: 'ec16-tts-error.json'});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  await openCatalog(app, page);
  const before = await backup(app);
  await studyButton(page).click();

  const preparation = page.getByTestId('scene-vocabulary');
  const audio = preparation.getByRole('button', {name: '朗读词汇', exact: true});
  await expect(audio).toBeVisible({timeout: 4000});
  await audio.click();
  await expect(preparation).toContainText('语音暂不可用');
  await preparation.getByRole('button', {name: '下一词', exact: true}).click();
  await expect(preparation.getByRole('heading', {name: 'one', exact: true})).toBeVisible();
  await preparation.getByRole('button', {name: '返回买饮品', exact: true}).click();
  await expect(studyButton(page)).toBeFocused();
  expect(await backup(app)).toEqual(before);
});

test('S95-10 audio contact is recorded only after playback starts', async ({app, page}) => {
  await page.addInitScript(() => {delete window.speechSynthesis;});
  await app.seedCards([{word: 'water', meaning: '水'}]);
  const warmed = await app.request.get('/api/tts/audio/water/preload');
  expect((await warmed.json()).cached).toBe(true);
  await openCatalog(app, page);
  await studyButton(page).click();
  const preparation = page.getByTestId('scene-vocabulary');
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toBeVisible();
  expect((await backup(app)).extensions.learning_contacts).toEqual([]);

  await preparation.getByRole('button', {name: '朗读词汇', exact: true}).click();
  await expect(preparation).toContainText('已播放词汇');
  await expect.poll(async () => (await backup(app)).extensions.learning_contacts.map(contact => contact.kind))
    .toEqual(['answer_audio']);
});

test('S95-10 direct challenge keeps the first task unaided in a missing-word library', async ({app, page}) => {
  await openCatalog(app, page);
  await sceneCard(page).getByRole('button', {name: '直接挑战', exact: true}).click();
  const run = page.getByTestId('scene-session');
  await expect(run).toContainText('第 1/3 轮');
  await expect(run).not.toContainText('Can I have water, please?');
  await expect(run.getByRole('textbox', {name: '你的答案', exact: true})).toHaveValue('');
  const state = await backup(app);
  expect(state.cards).toEqual([]);
  expect(state.extensions.practice_sessions).toHaveLength(1);
  expect(state.extensions.practice_items.every(item => item.assistance.length === 0)).toBe(true);
  expect(state.extensions.scene_attempts).toEqual([]);
  expect(state.extensions.learning_contacts).toEqual([]);
});

test('S95-10 leaving and reloading preparation preserves the same active round', async ({app, page}) => {
  await app.seedCards([
    {word: 'water', meaning: '水'},
    {word: 'one', meaning: '一'},
    {word: 'thank', meaning: '感谢'},
  ]);
  await openCatalog(app, page);
  await sceneCard(page).getByRole('button', {name: '直接挑战', exact: true}).click();
  const run = page.getByTestId('scene-session');
  await run.getByRole('textbox', {name: '你的答案', exact: true}).fill('A glass of water, please.');
  await run.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(run).toContainText('规则认可');
  const reply = run.getByTestId('scene-feedback').getByText('Water is ready.', {exact: true});
  await reply.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await backup(app)).extensions.learning_contacts.length).toBe(1);
  await run.getByRole('button', {name: '下一轮', exact: true}).click();
  await run.getByRole('button', {name: '返回场景列表', exact: true}).click();
  const before = await backup(app);

  await studyButton(page).click();
  const preparation = page.getByTestId('scene-vocabulary');
  await expect(preparation).toContainText('词汇准备');
  await preparation.getByRole('button', {name: '返回买饮品', exact: true}).click();
  await studyButton(page).click();
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toBeVisible();
  await page.reload();

  await sceneCard(page).getByRole('button', {name: '继续', exact: true}).click();
  await expect(run).toContainText('第 2/3 轮');
  await expect(run).toContainText('已处理 1/3');
  await expect(run).not.toContainText('One cup, please.');
  expect(await backup(app)).toEqual(before);
});

test('S95-10 late vocabulary response cannot change the selected scene', async ({app, page}) => {
  let started, deliver, settled;
  const loaded = new Promise(resolve => {started = resolve;});
  const release = new Promise(resolve => {deliver = resolve;});
  const finished = new Promise(resolve => {settled = resolve;});
  await page.route('**/api/scenes/drinks/vocabulary', async route => {
    const response = await route.fetch();
    started();
    await release;
    try {
      await route.fulfill({response});
    } finally {
      settled();
    }
  }, {times: 1});
  const before = await backup(app);
  await openCatalog(app, page);
  const preparation = page.getByTestId('scene-vocabulary');
  try {
    await studyButton(page).click();
    await loaded;
    await preparation.getByRole('button', {name: '返回买饮品', exact: true}).click();
    await studyButton(page, '自我介绍').click();
    await expect(preparation.getByRole('heading', {name: 'tea', exact: true})).toBeVisible();
  } finally {
    deliver();
  }
  await finished;
  await expect(preparation.getByRole('heading', {name: '自我介绍 · 词汇准备', exact: true})).toBeVisible();
  await expect(preparation).not.toContainText('water');
  expect(await backup(app)).toEqual(before);
});

test('S95-10 restore invalidates old preparation contact', async ({app, page}) => {
  const [id] = await app.seedCards([{word: 'water', meaning: '原词卡释义'}]);
  const saved = await (await app.request.get('/api/export/backup')).json();
  await openCatalog(app, page);
  await studyButton(page).click();
  const preparation = page.getByTestId('scene-vocabulary');
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toBeVisible();
  const preview = await app.request.post('/api/import/preview', {data: saved});
  expect(preview.ok()).toBe(true);
  const restored = await app.request.post('/api/import/cards', {
    data: {backup: saved, expected_revision: (await preview.json()).expected_revision},
  });
  expect(restored.ok()).toBe(true);
  const replacement = await backup(app);
  expect(replacement.cards[0].id).not.toBe(id);

  const confirmation = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/learning/contacts' && response.request().method() === 'POST');
  await preparation.getByRole('button', {name: '查看释义', exact: true}).click();
  expect([404, 409]).toContain((await confirmation).status());
  await expect(preparation.getByRole('alert')).toContainText('请重新读取本场景用词');
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toHaveCount(0);
  expect(await backup(app)).toEqual(replacement);

  await preparation.getByRole('button', {name: '重新读取用词', exact: true}).click();
  await expect(preparation.getByRole('heading', {name: 'water', exact: true})).toBeVisible();
  expect(await backup(app)).toEqual(replacement);
});

test('S95-10 lost contact confirmation replays the same submission', async ({app, page}) => {
  await app.seedCards([{word: 'water', meaning: '水'}]);
  let submission;
  await page.route('**/api/learning/contacts', async route => {
    submission = route.request().postDataJSON().submission_id;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  }, {times: 1});
  await openCatalog(app, page);
  await studyButton(page).click();
  const preparation = page.getByTestId('scene-vocabulary');
  await preparation.getByRole('button', {name: '查看释义', exact: true}).click();
  await expect(preparation.getByRole('alert')).toContainText('接触依据尚未确认');
  const replay = page.waitForRequest(request =>
    new URL(request.url()).pathname === '/api/learning/contacts' && request.method() === 'POST');
  await preparation.getByRole('button', {name: '继续确认接触', exact: true}).click();
  expect((await replay).postDataJSON().submission_id).toBe(submission);
  await expect(preparation.getByRole('alert')).toHaveCount(0);
  const state = await backup(app);
  expect(state.extensions.learning_contacts.map(contact => contact.submission_id)).toEqual([submission]);
  expect(state.learning_events).toEqual([]);
});
