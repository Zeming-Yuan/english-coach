import {createRequire} from 'node:module';
import {startSourceUI} from './support/source-ui.mjs';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {test,expect}=require('@playwright/test');
let ui;
test.beforeAll(async()=>{ui=await startSourceUI();});
test.afterAll(async()=>{await ui?.close();});

test('preparation failure leaves an idle attempt available for a new submission',async({page})=>{
  await ui.mountSource(page, `import {useLearningAttempt} from '/src/hooks/useLearningAttempt.js';
    function Component(){const a=useLearningAttempt('prepare',()=>{throw Error('timer unavailable');});window.attempt=a;return React.createElement('p',{},a.phase);}`);
  await expect(page.getByText('idle',{exact:true})).toBeVisible();
  const results=await page.evaluate(async()=>{
    const first=await window.attempt.submit('/api/reviews',{card_id:1}).then(()=>'',e=>e.message);
    const second=await window.attempt.submit('/api/reviews',{card_id:2}).then(()=>'',e=>e.message);
    return [first,second,localStorage.getItem('ec.pending.prepare')];
  });
  expect(results).toEqual(['timer unavailable','timer unavailable',null]);
});

test('a committed attempt is not recovered as failed after remount',async({page})=>{
  await page.route('**/api/reviews',route=>route.fulfill({json:{committed:true,event_id:'saved'}}));
  await ui.mountSource(page, `import {useLearningAttempt} from '/src/hooks/useLearningAttempt.js';
    function Attempt(){const a=useLearningAttempt('committed');window.attempt=a;return React.createElement('p',{},a.phase);}
    function Component(){const [n,setN]=React.useState(0);window.remount=()=>setN(n=>n+1);return React.createElement(Attempt,{key:n});}`);
  await expect(page.getByText('idle',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.attempt.submit('/api/reviews',{card_id:1}));
  await expect(page.getByText('saved',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.remount());
  await expect(page.getByText('idle',{exact:true})).toBeVisible({timeout:2000});
  expect(await page.evaluate(()=>localStorage.getItem('ec.pending.committed'))).toBeNull();
});

test('a failed FSRS write stays visible and does not count the answer as saved',async({page})=>{
  await page.route('**/api/typing/check',route=>route.fulfill({json:{committed:true,correct:true,expected:'apple'}}));
  await page.route('**/api/reviews',route=>route.fulfill({status:503,json:{detail:'scheduler unavailable'}}));
  await ui.mountSource(page, `import {usePracticeSession} from '/src/lib/practiceSession.js';
    function Component(){const p=usePracticeSession({buildItems:async()=>[{type:'spell',q:{card_id:1,word:'apple'}}],fsrsOnSpell:true});window.practice=p;return React.createElement('p',{},p.phase+' '+p.saveError);}`);
  await expect(page.getByText('ready',{exact:true})).toBeVisible();
  const result=await page.evaluate(()=>window.practice.submit('apple').then(()=>null,e=>e.message));
  expect(result).toBe('scheduler unavailable');
  await expect(page.getByText(/scheduler unavailable/)).toBeVisible();
  expect(await page.evaluate(()=>window.practice.stats.correct)).toBe(0);
});

test('a rejected custom skip reports an error without unhandled rejection or progress',async({page})=>{
  await ui.mountSource(page, `import {usePracticeSession} from '/src/lib/practiceSession.js';
    function Component(){const p=usePracticeSession({buildItems:async()=>[{type:'spell',q:{card_id:1},skip:async()=>{throw Error('skip offline');}}]});window.practice=p;return React.createElement('p',{},p.phase+' '+p.saveError);}`);
  await expect(page.getByText('ready',{exact:true})).toBeVisible();
  const result=await page.evaluate(()=>window.practice.skip().then(()=>null,e=>e.message));
  expect(result).toBeNull();
  await expect(page.getByText(/skip offline/)).toBeVisible({timeout:2000});
  expect(await page.evaluate(()=>window.practice.stats.wrongList)).toEqual([]);
});

test('resuming a saved typed answer updates the practice statistics exactly once',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('ec.pending.typed-attempt',JSON.stringify({path:'/api/typing/check',payload:{card_id:1,user_input:'apple',source:'spelling',submission_id:'saved-attempt'}})));
  await page.route('**/api/typing/check',route=>route.fulfill({json:{committed:true,correct:true,expected:'apple'}}));
  await ui.mountSource(page, `import {usePracticeSession} from '/src/lib/practiceSession.js';
    function Component(){const p=usePracticeSession({buildItems:async()=>[{type:'spell',q:{card_id:1,word:'apple'}}],typedAttempt:()=>({source:'spelling'})});window.practice=p;return React.createElement('p',{},p.phase);}`);
  await expect(page.getByText('ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.practice.resumePending());
  await expect.poll(()=>page.evaluate(()=>window.practice.stats.correct)).toBe(1,{timeout:2000});
  await page.evaluate(()=>window.practice.resumePending());
  expect(await page.evaluate(()=>window.practice.stats.correct)).toBe(1);
});

test('content list loading errors remain visible and can be retried',async({page})=>{
  for(const [view,path,payload] of [
    ['WordsPage','/api/cards',{cards:[]}],
    ['StoriesPage','/api/stories',{stories:[]}],
    ['LessonsPage','/api/lessons',{lessons:[],next_level:1,is_done:false}],
  ]){
    let failing=true;
    await page.route('**'+path,route=>route.fulfill(failing?{status:503,json:{detail:'content offline'}}:{json:payload}));
    await ui.mount(page, '/src/views/'+view+'.jsx');
    await expect(page.getByRole('alert')).toContainText('content offline',{timeout:2000});
    failing=false;
    await page.getByRole('button',{name:'重试加载',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.unroute('**'+path);
  }
});

test('the last practice answer shows feedback before the summary',async({page})=>{
  const item={id:'one',status:'pending',prompt:'苹果',kind:'typed',assistance:[]};
  const session={id:'round',purpose:'lesson_check',status:'incomplete',lifecycle:'active',items:[item],counts:{total:1,processed:0,passed:0,weak:0,skipped:0}};
  await page.route('**/api/practice-sessions/round',route=>route.fulfill({json:session}));
  await page.route('**/api/practice-sessions/round/items/one/attempts',route=>route.fulfill({json:{committed:true,correct:true,expected:'apple',session:{...session,status:'passed',items:[{...item,status:'passed'}],counts:{...session.counts,processed:1,passed:1}}}}));
  await ui.mount(page,'/src/views/PracticePage.jsx',"{sessionId:'round',onExit(){},onRestart(){}}");
  await page.getByRole('textbox',{name:'英文答案'}).fill('apple');
  await page.getByRole('button',{name:'提交',exact:true}).click();
  await expect(page.getByText('✅ 正确！已保存')).toBeVisible();
  await expect(page.locator('.study-done')).toHaveCount(0);
  await page.getByRole('button',{name:'查看结果',exact:true}).click();
  await expect(page.locator('.study-done')).toBeVisible();
});

test('empty study queues and malformed practice responses show a usable message',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await ui.mount(page,'/src/views/StudyPage.jsx',"{queue:[],onExit(){}}");
  await expect(page.getByRole('status')).toContainText('没有待学习的卡片',{timeout:2000});
  await page.route('**/api/practice-sessions/broken',route=>route.fulfill({json:{id:'broken'}}));
  await ui.mount(page,'/src/views/PracticePage.jsx',"{sessionId:'broken',onExit(){}}");
  await expect(page.getByRole('alert')).toContainText('练习数据不完整',{timeout:2000});
  expect(errors).toEqual([]);
});

test('word detail load and delete failures are visible without leaving the list',async({page})=>{
  let detailFail=true;
  const card={id:1,kind:'word',word:'apple',meaning:'苹果',contexts:[],review_count:0};
  await page.route('**/api/cards',route=>route.fulfill({json:{cards:[card]}}));
  await page.route('**/api/tts/**',route=>route.fulfill({body:''}));
  await page.route('**/api/cards/1',route=>route.fulfill(route.request().method()==='DELETE'||detailFail?{status:503,json:{detail:'detail offline'}}:{json:card}));
  await ui.mount(page,'/src/views/WordsPage.jsx');
  await page.locator('.word-item').click();
  await expect(page.getByRole('alert')).toContainText('detail offline',{timeout:2000});
  detailFail=false;
  await page.getByRole('button',{name:'重试加载',exact:true}).click();
  await expect(page.locator('.word-detail-view')).toBeVisible();
  page.on('dialog',dialog=>dialog.accept());
  await page.getByLabel('更多操作').click();
  await page.getByRole('button',{name:'删除',exact:true}).click({timeout:2000});
  await expect.poll(()=>page.evaluate(()=>window.__toastData?.msg),{timeout:2000}).toContain('detail offline');
});

test('add-word results display plain text without HTML entity escaping',async({page})=>{
  await page.route('**/api/cards/generate',route=>route.fulfill({json:{generated:1,skipped:0,cards:[{id:1,word:'tea & coffee'}]}}));
  await ui.mount(page,'/src/views/AddPage.jsx');
  await page.getByRole('textbox',{name:''}).fill('tea');
  await page.getByRole('button',{name:'AI 生成词卡',exact:true}).click();
  await expect(page.locator('.add-result .ok')).toContainText('tea & coffee',{timeout:2000});
});

test('starter requests reject a second click while the first is still pending',async({page})=>{
  await ui.mountSource(page,`import {useStarterCards} from '/src/hooks/useStarterCards.js';
    function Component(){const [count,setCount]=React.useState(0);const a=useStarterCards(async()=>{setCount(n=>n+1);return new Promise(resolve=>{window.releaseStarter=resolve;});});window.starter=a;return React.createElement('p',{},'calls:'+count);}`);
  await expect(page.getByText('calls:0')).toBeVisible();
  await page.evaluate(()=>{window.firstStarter=window.starter.addStarter();window.secondStarter=window.starter.addStarter();});
  await expect(page.getByText('calls:1')).toBeVisible({timeout:2000});
  await page.evaluate(()=>window.releaseStarter({cards:[]}));
});

test('an answer mounted after its hook becomes visible still records contact',async({page})=>{
  let posts=0;
  await page.route('**/api/learning/contacts',route=>{posts++;return route.fulfill({json:{committed:true}});});
  await ui.mountSource(page,`import {usePracticeAnswerContact} from '/src/hooks/usePracticeAnswerContact.js';
    function Component(){const [shown,setShown]=React.useState(false);const ref=usePracticeAnswerContact({card_id:1,revision:{identity:'card',version:1}},true,'spelling');return React.createElement('div',{},React.createElement('button',{onClick:()=>setShown(true)},'show'),shown&&React.createElement('p',{ref},'answer'));}`);
  await page.getByRole('button',{name:'show',exact:true}).click();
  await expect.poll(()=>posts,{timeout:2000}).toBe(1);
});

test('word lookup distinguishes a failed request from a word without a definition',async({page})=>{
  await page.route('**/api/lookup/apple',route=>route.fulfill({status:503,json:{detail:'lookup offline'}}));
  await ui.mountSource(page,`import {useWordLookup} from '/src/lib/wordLookup.js';
    function Component(){const q=useWordLookup();return React.createElement('div',{},React.createElement('button',{onClick:()=>q.open('apple')},'lookup'),React.createElement('output',{},q.result.status+':'+(q.result.error||'')));}`);
  await page.getByRole('button',{name:'lookup',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('error:lookup offline',{timeout:2000});
});

test('refreshing lesson progress keeps the current reader mounted',async({page})=>{
  const lesson={id:1,level:1,title:'Reader',content:{words:[],dialogue:[]},words:[{id:1,word:'apple',meaning:'苹果'}],card_ids:{apple:1}};
  let listLoads=0;let release;const barrier=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/lessons'){
      if(++listLoads>1) await barrier;
      return route.fulfill({json:{lessons:[lesson],next_level:2,is_done:false}});
    }
    if(path==='/api/lessons/1')return route.fulfill({json:lesson});
    if(path.endsWith('/opened'))return route.fulfill({json:{learning_progress:{status:'opened'}}});
    return route.fulfill({json:{committed:true}});
  });
  try{
    await ui.mount(page,'/src/views/LessonsPage.jsx');
    await page.getByText('第 1 课 · Reader',{exact:true}).last().click();
    await expect.poll(()=>listLoads,{timeout:2000}).toBe(2);
    await expect(page.getByText('apple',{exact:true})).toBeVisible({timeout:2000});
  }finally{release();}
});

test('recovered answers keep all newly loaded unanswered questions in the round',async({page})=>{
  for (const includeRecovered of [false,true]) {
  await page.addInitScript(()=>localStorage.setItem('ec.pending.typed-attempt',JSON.stringify({path:'/api/typing/check',payload:{card_id:1,user_input:'apple',source:'spelling',submission_id:'old-answer'}})));
  await page.route('**/api/typing/check',route=>route.fulfill({json:{committed:true,correct:true,expected:'apple'}}));
  await ui.mountSource(page, `import {usePracticeSession} from '/src/lib/practiceSession.js';
    function Component(){const p=usePracticeSession({buildItems:async()=>${JSON.stringify([{type:'spell',q:{card_id:2,word:'pear'}}, ...(includeRecovered ? [{type:'spell',q:{card_id:1,word:'apple'}}] : [])])},typedAttempt:()=>({source:'spelling'})});window.practice=p;return React.createElement('p',{},p.phase);}`);
  await expect(page.getByText('ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.practice.resumePending());
  await expect.poll(()=>page.evaluate(()=>({word:window.practice.q.word,total:window.practice.total,correct:window.practice.stats.correct})),{timeout:2000}).toEqual({word:'apple',total:2,correct:1});
  await page.evaluate(()=>window.practice.next());
  await expect.poll(()=>page.evaluate(()=>({phase:window.practice.phase,word:window.practice.q.word})),{timeout:2000}).toEqual({phase:'ready',word:'pear'});
  }
});

test('failed lesson progress refresh preserves the open reader and reports the error',async({page})=>{
  const lesson={id:1,level:1,title:'Reader',content:{words:[],dialogue:[]},words:[{id:1,word:'apple',meaning:'苹果'}],card_ids:{apple:1}};
  let loads=0;
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/lessons')return route.fulfill(++loads===1?{json:{lessons:[lesson],next_level:2,is_done:false}}:{status:503,json:{detail:'progress offline'}});
    if(path==='/api/lessons/1')return route.fulfill({json:lesson});
    if(path.endsWith('/opened'))return route.fulfill({json:{learning_progress:{status:'opened'}}});
    return route.fulfill({json:{committed:true}});
  });
  await ui.mount(page,'/src/views/LessonsPage.jsx');
  await page.getByText('第 1 课 · Reader',{exact:true}).last().click();
  await expect(page.getByRole('alert')).toContainText('progress offline');
  await expect(page.getByText('apple',{exact:true})).toBeVisible({timeout:2000});
});

test('a failed word-list refresh preserves the current edited card detail',async({page})=>{
  const card={id:1,kind:'word',word:'apple',meaning:'苹果',contexts:[],review_count:0};
  let loads=0;
  await page.route('**/api/cards',route=>route.fulfill(++loads===1?{json:{cards:[card]}}:{status:503,json:{detail:'word list offline'}}));
  await page.route('**/api/cards/1',route=>route.fulfill({json:card}));
  await page.route('**/api/tts/**',route=>route.fulfill({body:''}));
  await ui.mount(page,'/src/views/WordsPage.jsx');
  await page.locator('.word-item').click();
  page.on('dialog',dialog=>dialog.accept('new meaning'));
  await page.getByRole('button',{name:/编辑内容/}).click();
  await expect(page.getByRole('alert')).toContainText('word list offline');
  await expect(page.locator('.word-detail-view')).toBeVisible({timeout:2000});
});

test('adding a lookup word updates reader state and allows reopening its definition',async({page})=>{
  const story={id:1,mode:'legacy',title:'Reader story',content:'Apple.',words:[],visible_card_ids:[],line_card_ids:[[]]};
  await page.route('**/api/stories',route=>route.fulfill({json:{stories:[story],generation_enabled:false,simplification_enabled:false}}));
  await page.route('**/api/stories/1',route=>route.fulfill({json:story}));
  await page.route('**/api/lookup/apple',route=>route.fulfill({json:{found:true,meaning:'苹果',phonetic:'/apple/',card_id:null}}));
  await page.route('**/api/cards/generate',route=>route.fulfill({json:{generated:1,cards:[{id:20,word:'apple',meaning:'苹果',phonetic:'/apple/'}]}}));
  await ui.mount(page,'/src/views/StoriesPage.jsx');
  await page.locator('.story-item-title').click();
  await page.getByRole('button',{name:'查词 apple',exact:true}).click();
  await page.getByRole('button',{name:'加入单词本',exact:true}).click();
  await expect(page.locator('.reader-targets summary')).toContainText('1');
  await expect(page.getByRole('button',{name:'加入单词本',exact:true})).toHaveCount(0);
  await expect(page.locator('.story-word-panel-meaning')).toContainText('苹果');
});
