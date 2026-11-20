import {test, expect} from './support/test.mjs';

async function openDrinks(app, page) {
  await page.goto(app.baseURL);
  await page.getByRole('button', {name: '场景练习', exact: true}).click();
  await page.getByRole('article', {name: '买饮品', exact: true})
    .getByRole('button', {name: /^(开始|直接挑战|继续)$/}).click();
  return page.getByTestId('scene-session');
}

async function submit(run, text) {
  await run.getByRole('textbox', {name: '你的答案', exact: true}).fill(text);
  await run.getByRole('button', {name: '提交答案', exact: true}).click();
  await expect(run).toContainText('已保存');
}

async function finish(run) {
  await run.getByRole('button', {name: '下一轮', exact: true}).click();
  await submit(run, 'One cup, please.');
  await run.getByRole('button', {name: '下一轮', exact: true}).click();
  await submit(run, 'Yes, thank you.');
  await run.getByRole('button', {name: '查看结果', exact: true}).click();
}

test('S95-11 unjudged answer has neutral feedback and optional reference', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-disabled.json'});
  const run = await openDrinks(app, page);
  await submit(run, 'A single glass would be lovely.');
  await expect(run.getByTestId('scene-feedback')).toContainText('Let us continue.');
  await expect(run.getByTestId('scene-feedback')).not.toContainText(/try again|请用请求句式/);
  await expect(run).toContainText('这条表达未被当前规则可靠判定');
  await expect(run.getByRole('button', {name: '下一轮', exact: true})).toBeEnabled();
  await run.getByRole('button', {name: '查看标准表达', exact: true}).click();
  await expect(run.getByText('标准表达（本轮按辅助记录）：Can I have water, please?', {exact: true})).toBeVisible();
  await finish(run);
  await expect(run).toContainText('本场景尚未独立通过');
});

test('S95-11 reviewed expression completes independent three first answers', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-disabled.json'});
  const run = await openDrinks(app, page);
  await submit(run, 'A glass of water, please.');
  await expect(run).toContainText('规则认可');
  await finish(run);
  await expect(run).toContainText('本场景独立通过');
});

test('S95-11 unknown then retry cannot replace first response', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-disabled.json'});
  const run = await openDrinks(app, page);
  await submit(run, 'A single glass would be lovely.');
  await run.getByRole('button', {name: '再练本轮', exact: true}).click();
  await submit(run, 'A glass of water, please.');
  await expect(run).toContainText('规则认可 · 再练结果，首答不变');
  await finish(run);
  await expect(run).toContainText('本场景尚未独立通过');
  const backup = await (await app.request.get('/api/export/backup')).json();
  const first = backup.extensions.scene_attempts[0];
  expect(first.verdict).toBe('unknown');
  expect(backup.extensions.practice_items[0].first_task_attempt_id).toBe(first.attempt_id);
  const replay = await app.request.post(
    `/api/practice-sessions/${first.session_id}/items/${first.item_id}/attempts`,
    {data: {submission_id: first.submission_id, answer: first.answer}},
  );
  expect(await replay.json()).toEqual(first.response);
  const after = await (await app.request.get('/api/export/backup')).json();
  expect(after.extensions.scene_attempts).toEqual(backup.extensions.scene_attempts);
});

test('S95-11 revealed answer cannot become independent pass', async ({appFactory, page}) => {
  const app = await appFactory({fixture: 'el16-disabled.json'});
  const run = await openDrinks(app, page);
  await run.getByRole('button', {name: '查看标准表达', exact: true}).click();
  await expect(run.getByText('标准表达（本轮按辅助记录）：Can I have water, please?', {exact: true})).toBeVisible();
  await submit(run, 'Can I have water, please?');
  await finish(run);
  await expect(run).toContainText('本场景尚未独立通过');
});
