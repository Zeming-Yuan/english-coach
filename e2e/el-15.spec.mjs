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
