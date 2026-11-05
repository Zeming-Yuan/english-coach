import {test, expect} from './support/test.mjs';
import {startSourceUI} from './support/source-ui.mjs';

test.setTimeout(30000);
let ui;
test.beforeEach(async () => {ui = await startSourceUI();});
test.afterEach(async () => {await ui.close();});
const styles = `import '@fontsource-variable/noto-sans-sc'; import '/@fs${new URL('../app/static/style.css', import.meta.url).pathname}';
import '/src/styles/product-theme.css'; import '/src/styles/home-workspace.css';
import '/src/styles/qwerty-spelling.css'; import '/src/views/scene-page.css';`;
async function mount(page, app, component = '/src/App.jsx') {
  await page.route(/https?:\/\/[^/]+\/(?:api|static)\//, async route => {
    const url = new URL(route.request().url());
    const response = await app.request.fetch(app.baseURL + url.pathname + url.search, {
      method: route.request().method(), data: route.request().postData() || undefined,
      headers: {'content-type': 'application/json'},
    });
    await route.fulfill({response});
  });
  await ui.mountSource(page, `${styles} import Component from '${component}';`);
}
async function snap(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: `/tmp/ec-verified-fixes/${name}.png`, fullPage: true});
}

test('home daily action uses two equal columns at its middle breakpoint and one on mobile', async ({page, appFactory}) => {
  const app = await appFactory({fixture: 'full-design.json'});
  await mount(page, app);
  await expect(page.locator('.home-round-body')).toBeVisible();
  await page.setViewportSize({width:1280,height:900});
  const widths = await page.locator('.home-round-body').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat));
  await snap(page, 'home-1280');
  expect(widths).toHaveLength(2);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(1);
  await page.setViewportSize({width:420,height:880});
  const summary = await page.locator('.home-round-summary').boundingBox();
  const action = await page.locator('.home-round-action').boundingBox();
  expect(action.y).toBeGreaterThan(summary.y + summary.height);
  expect(Math.abs(action.x - summary.x)).toBeLessThan(1);
  await snap(page, 'home-mobile');
});

async function contrast(locator) {
  return locator.evaluate(el => {
    const rgb = color => color.match(/[\d.]+/g).slice(0,3).map(Number);
    const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i], 0);
    let surface = el;
    while (surface.parentElement && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
    const a = luminance(getComputedStyle(el).color), b = luminance(getComputedStyle(surface).backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
}

test('home record description stays readable in dark mode', async ({page, appFactory}) => {
  await mount(page, await appFactory({fixture:'full-design.json'}));
  await expect(page.locator('.home-record-total').first()).toBeVisible();
  await page.evaluate(() => document.body.classList.add('dark'));
  await snap(page, 'home-dark');
  expect(await contrast(page.locator('.home-record-total').first())).toBeGreaterThanOrEqual(4.5);
});

test('saved scene feedback spans the result grid and restart has a single stable action', async ({page, app}) => {
  await mount(page, app);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button', {name:'场景练习',exact:true}).click();
  await page.getByRole('button', {name:'买饮品',exact:true}).click();
  const scene = page.getByTestId('scene-session');
  for (let i=0;i<3;i++) {
    await scene.getByRole('button', {name:'跳过本轮',exact:true}).click();
    await scene.getByRole('button', {name:/下一轮|查看结果/}).click();
  }
  await expect(scene.locator('.scene-result')).toBeVisible();
  const grid = await scene.boundingBox();
  const feedback = await scene.locator('.scene-saved-feedback').first().boundingBox();
  await snap(page, 'scene-desktop');
  expect(Math.abs(feedback.width - grid.width)).toBeLessThan(1);
  await expect(scene.getByRole('button', {name:'新开一轮',exact:true})).toHaveCount(1);
  await page.setViewportSize({width:420,height:880});
  await expect(scene.getByRole('button', {name:'新开一轮',exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await snap(page, 'scene-mobile');
});

test('mobile reader backdrop fills the viewport and closes the word panel on tap', async ({page, appFactory}) => {
  await page.setViewportSize({width:420,height:880});
  await mount(page, await appFactory({fixture:'story-reader-regressions.json'}));
  await page.getByRole('button',{name:'打开故事库',exact:true}).click();
  await page.getByText('Reader regression 1',{exact:true}).click();
  await page.locator('.sw,.story-clickable-word').first().click();
  await expect(page.getByRole('dialog',{name:'词语释义'})).toBeVisible();
  const backdrop = page.locator('.story-word-backdrop');
  const rect = await backdrop.boundingBox();
  await snap(page,'reader-mobile');
  expect(rect).toEqual({x:0,y:0,width:420,height:880});
  await backdrop.click({position:{x:20,y:20}});
  await expect(page.getByRole('dialog',{name:'词语释义'})).toHaveCount(0);
});

test('dark dialogue text and legacy history ratings use readable dark surfaces', async ({page}) => {
  await ui.mountSource(page, `${styles}
    function Component() {
      return React.createElement('main', {className:'product-app', style:{padding:'30px'}},
        ...['a','b'].map(side => React.createElement('div', {key:side,className:'bubble bubble-'+side},
          React.createElement('div',{className:'bubble-en'},'A friendly conversation.'),
          React.createElement('div',{className:'bubble-cn'},'一段友好的对话。'))),
        React.createElement('div', {className:'history-list'}, ...[1,2,3].map(r => React.createElement('span', {key:r,className:'history-rating rating-'+r},'评分 '+r))));
    }`);
  await expect(page.locator('.bubble-a')).toBeVisible();
  await page.evaluate(() => document.body.classList.add('dark'));
  await snap(page, 'dark-dialogue-ratings');
  for (const selector of ['.bubble-a .bubble-en','.bubble-a .bubble-cn','.bubble-b .bubble-en','.bubble-b .bubble-cn','.history-rating.rating-1','.history-rating.rating-2','.history-rating.rating-3']) {
    expect(await contrast(page.locator(selector)), selector).toBeGreaterThanOrEqual(4.5);
  }
});

test('reduced motion keeps the assisted native caret hidden and independent typing visible', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await ui.mountSource(page, `${styles} import SpellingBoard from '/src/components/SpellingBoard.jsx';
    function Component() {
      const [assisted,setAssisted] = React.useState(true);
      return React.createElement('main',{className:'product-app'}, React.createElement('section',{className:'qwerty-spelling'},
        React.createElement('button',{onClick:()=>setAssisted(false)},'独立输入'),
        React.createElement(SpellingBoard,{key:String(assisted), variant:'qwerty',mode:assisted?'assisted':'independent', target:'apple',feedbackState:'correct',onSubmit:()=>{}})));
    }`);
  const input = page.getByRole('textbox',{name:'英文拼写'});
  await input.fill('app');
  await snap(page,'spelling-reduced-motion');
  await expect(input).toHaveCSS('caret-color','rgba(0, 0, 0, 0)');
  await expect(input).toHaveCSS('-webkit-text-fill-color','rgba(0, 0, 0, 0)');
  await page.getByRole('button',{name:'独立输入'}).click();
  await input.fill('apple');
  expect(await input.evaluate(el => getComputedStyle(el).caretColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await input.evaluate(el => getComputedStyle(el).webkitTextFillColor)).not.toBe('rgba(0, 0, 0, 0)');
});
