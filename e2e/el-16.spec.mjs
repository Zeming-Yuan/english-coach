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
