import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {test:baseTest,expect}=require('@playwright/test');
const {startPracticeServer}=await import('./support/p0-p1-practice-server.mjs');
let base;
const test=baseTest.extend({practiceServer:[async({},use)=>{
  const server=await startPracticeServer();
  base=server.resolvedUrls.local[0].replace(/\/$/,'');
  try {await use(base);} finally {await server.close();}
},{scope:'worker',auto:true}]});
async function harness(page, name, props={}) {
  await page.route('**/harness',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">await import('/@fs${new URL('./support/p0-p1-practice-harness.jsx',import.meta.url).pathname}');</script>`}));
  await page.goto(base+'/harness');
  await page.waitForFunction(()=>Boolean(window.mount));
  await page.evaluate(({name,props})=>window.mount(name,props),{name,props});
}
async function json(route,body,status=200){await route.fulfill({status,json:body});}

test('recovered delayed run opens by id without resubmitting creation',async({page})=>{
  let creations=0;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='POST' && url.pathname==='/api/practice-sessions'){creations++;return json(route,{detail:'frozen request differs'},409);}
    if(url.pathname==='/api/practice-sessions')return json(route,{sessions:[{id:'existing'}]});
    if(url.pathname==='/api/practice-sessions/existing')return json(route,{id:'existing',purpose:'delayed_check',lifecycle:'active',items:[]});
    return json(route,{});
  });
  await harness(page,'DelayedCheckPage',{window:'day'});
  await expect(page.getByRole('button',{name:'重新查找候选'})).toBeVisible({timeout:2000});
  expect(creations).toBe(0);
});

test('malformed mixed recovery falls back to a usable fresh queue',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('ec.mixed.pending',JSON.stringify({items:[],idx:0,stats:null,pending:{payload:{}}})));
  await page.route('**/api/**',route=>json(route,{questions:[],cards:[],new_cards:[],due_cards:[]}));
  await harness(page,'MixedPage');
  await expect(page.getByText('没有可练习的题目，先去加词吧')).toBeVisible({timeout:2000});
  expect(errors).toEqual([]);
});

const scene={id:'scene',content_hash:'hash'};
const feedback=(id,text)=>({session_id:'scene',item_id:id,attempt_id:'attempt-'+id,content_hash:'hash',origin:'template',text});
test('scene feedback follows the current item when props change',async({page})=>{
  await page.route('**/api/**',async route=>{
    const match=route.request().url().match(/items\/(\w+)\/feedback/);
    if(match)return json(route,feedback(match[1],match[1]==='one'?'First response':'Second response'));
    return json(route,{cards:[]});
  });
  await harness(page,'SceneFeedback',{session:scene,item:{id:'one',attempt_id:'attempt-one'}});
  await expect(page.getByText('First response',{exact:true})).toBeVisible();
  await page.evaluate(({session,item})=>window.mount('SceneFeedback',{session,item}),{session:scene,item:{id:'two',attempt_id:'attempt-two'}});
  await expect(page.getByText('Second response',{exact:true})).toBeVisible({timeout:2000});
  await expect(page.getByText('First response',{exact:true})).toHaveCount(0);
});

test('attempt clear during save preserves the original durable request',async({page})=>{
  let release;const barrier=new Promise(resolve=>release=resolve);
  await page.route('**/api/reviews',async route=>{await barrier;await json(route,{committed:true});});
  await harness(page,'Attempt');
  await expect(page.getByText('idle',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.first=window.attempt.submit('/api/reviews',{card_id:1}).catch(e=>e.message);});
  await expect(page.getByText('saving',{exact:true})).toBeVisible();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.pending.race')));
  const after=await page.evaluate(async()=>{
    window.attempt.clear();
    const rejected=await window.attempt.submit('/api/reviews',{card_id:2}).then(()=>false,()=>true);
    return {saved:JSON.parse(localStorage.getItem('ec.pending.race')),rejected};
  });
  expect(after.saved).toEqual(before);
  expect(after.rejected).toBe(true);
  await expect(page.getByText('saving',{exact:true})).toBeVisible({timeout:2000});
  release();await page.evaluate(()=>window.first);
  await expect(page.getByText('saved',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.attempt.clear());
  expect(await page.evaluate(()=>localStorage.getItem('ec.pending.race'))).toBeNull();
});

test('practice skip cannot send a second answer while saving',async({page})=>{
  let release;const barrier=new Promise(resolve=>release=resolve);const payloads=[];
  await page.route('**/api/typing/check',async route=>{payloads.push(route.request().postDataJSON());await barrier;await json(route,{committed:true,correct:true,expected:'apple'});});
  await harness(page,'Practice');await expect(page.getByText('ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.first=window.practice.submit('apple');});
  await expect.poll(()=>payloads.length).toBe(1);
  await page.evaluate(()=>{window.skipping=window.practice.skip();});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.pending.typed-attempt')).payload.skipped)).toBe(false);
  release();await page.evaluate(()=>Promise.all([window.first,window.skipping]));
  expect(payloads).toHaveLength(1);
  expect(await page.evaluate(()=>window.practice.stats.correct)).toBe(1);
  expect(await page.evaluate(()=>window.practice.stats.wrongList)).toEqual([]);
});

const revision={identity:'117ac02b-f79f-484b-8011-cbbfc4555200',version:1};
const lesson={id:1,level:1,title:'First lesson',content:{words:[],dialogue:[]},words:[{id:1,word:'apple',meaning:'苹果',content_revision:revision}],card_ids:{apple:1},content_revision:revision};
async function lessonRoutes(page,handler=()=>false){
  await page.route('**/api/**',async route=>{
    if(await handler(route))return;
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/lessons')return json(route,{lessons:[lesson],next_level:2,done:false});
    if(path==='/api/lessons/1')return json(route,lesson);
    return json(route,{committed:true});
  });
}
async function openLesson(page){await harness(page,'LessonsPage');await page.getByText('第 1 课 · First lesson',{exact:true}).last().click();}

test('visible lesson vocabulary records contact before revealing meaning',async({page})=>{
  const contacts=[];
  await lessonRoutes(page,async route=>{
    if(route.request().url().endsWith('/api/learning/contacts')){contacts.push(route.request().postDataJSON());await json(route,{committed:true});return true;}
  });
  await openLesson(page);await expect(page.getByText('apple',{exact:true})).toBeVisible();
  await expect.poll(()=>contacts.length,{timeout:2000}).toBe(1);
  expect(contacts[0]).toMatchObject({card_id:1,source:'lesson',kind:'answer_visible',revision});
});

test('saved lesson mastery cannot record another review in the same view',async({page})=>{
  const reviews=[];
  await lessonRoutes(page,async route=>{
    if(route.request().url().endsWith('/api/reviews')){reviews.push(route.request().postDataJSON());await json(route,{committed:true});return true;}
  });
  await openLesson(page);await page.getByRole('button',{name:'猜不到',exact:true}).click();
  const mastery=page.getByTestId('rate-good');await mastery.click();
  await expect(page.locator('.word-mastered')).toHaveCount(1);
  await expect(mastery).toBeDisabled({timeout:2000});
  expect(reviews).toHaveLength(1);
});

test('completed course still confirms a pending final generation',async({page})=>{
  const pending={path:'/api/lessons/next',payload:{operation_id:'final-generation'}};const requests=[];
  await page.addInitScript(p=>localStorage.setItem('ec.lessongen.next',JSON.stringify(p)),pending);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/lessons')return json(route,{lessons:[{...lesson,level:20}],next_level:21,is_done:true});
    if(path==='/api/lessons/next'){requests.push(route.request().postDataJSON());return json(route,{...lesson,level:20});}
    return json(route,{committed:true});
  });
  await harness(page,'LessonsPage');
  await page.getByRole('button',{name:'继续确认生成',exact:true}).click();
  await expect(page.getByTestId('lesson-goal')).toBeVisible({timeout:2000});
  expect(requests).toEqual([{operation_id:'final-generation'}]);
  expect(await page.evaluate(()=>localStorage.getItem('ec.lessongen.next'))).toBeNull();
});

test('story review returns to the text without helping stale items',async({page})=>{
  const assistance=[];
  await page.route('**/api/**',async route=>{
    if(route.request().url().endsWith('/assistance')){assistance.push(route.request().postDataJSON());return json(route,{detail:'stale item'},409);}
    return json(route,{id:'story-run',purpose:'story_check',lifecycle:'active',counts:{total:1,processed:0},items:[{id:'stale',status:'stale',prompt:'Old question'}]});
  });
  await harness(page,'StoryCheck',{story:{id:1,version_id:'v1',check_session_id:'story-run'},children:'Original story text'});
  await page.getByRole('button',{name:'← 回看原文',exact:true}).click();
  await expect(page.getByRole('button',{name:'返回检查',exact:true})).toBeVisible({timeout:2000});
  await expect(page.locator('#root')).toContainText('Original story text');
  expect(assistance).toEqual([]);
});

test('valid mixed choice recovery keeps its original request and queue',async({page})=>{
  const command={card_id:1,source:'mixed',stage:'standalone',kind:'choice',assistance:[],skipped:false,answer:'apple',question_token:'token',submission_id:'5812af28-cc41-4760-a3da-63dcff6446a8'};
  const record={pending:{path:'/api/quiz/score',payload:{answers:[command]}},items:[{type:'choice',q:{card_id:1,prompt:'苹果',options:['apple','book'],question_token:'token',content_revision:revision}}],idx:0,stats:{correct:0,skipped:0,wrongList:[],skippedList:[]},assistance:[],value:'apple',skipped:false};
  await page.addInitScript(r=>localStorage.setItem('ec.mixed.pending',JSON.stringify(r)),record);
  const requests=[];
  await page.route('**/api/**',async route=>{
    if(route.request().url().endsWith('/api/quiz/score')){requests.push(route.request().postDataJSON());return json(route,{details:[{committed:true,correct:true,expected:'apple'}]});}
    return json(route,{questions:[],cards:[],new_cards:[],due_cards:[],committed:true});
  });
  await harness(page,'MixedPage');
  await page.getByRole('button',{name:'继续确认 / 重试保存',exact:true}).click({timeout:2000});
  await expect(page.getByRole('status')).toContainText('已保存');
  expect(requests).toEqual([{answers:[command]}]);
});

test('failed feedback lookup remains conservative and can hand off to a durable contact retry',async({page})=>{
  let lookup=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/cards')return ++lookup===1?json(route,{detail:'offline'},503):json(route,{cards:[{id:1,kind:'word',word:'apple',content_revision:revision}]});
    if(path==='/api/learning/contacts')return json(route,{detail:'offline'},503);
    return json(route,{});
  });
  const props={session:scene,item:{id:'one',attempt_id:'attempt-one',feedback:feedback('one','An apple.')}};
  await harness(page,'SceneFeedback',props);
  await expect(page.getByRole('button',{name:'继续确认接触',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('ec.contact.lookup:scene-feedback:scene:one'))).not.toBeNull();
  await page.getByRole('button',{name:'继续确认接触',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('ec.contact.lookup:scene-feedback:scene:one'))).toBeNull();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.contact.scene:answer_visible:1')))).toMatchObject({path:'/api/learning/contacts',payload:{card_id:1}});
});

test('mixed recovery rejects malformed nested question display values',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const record={pending:{path:'/api/quiz/score',payload:{answers:[{card_id:1,submission_id:'old'}]}},items:[{type:'choice',q:{card_id:1,prompt:{broken:true},options:['apple']}}],idx:0,stats:{correct:0,skipped:0,wrongList:[],skippedList:[]},assistance:[],skipped:false};
  await page.addInitScript(r=>localStorage.setItem('ec.mixed.pending',JSON.stringify(r)),record);
  await page.route('**/api/**',route=>json(route,{questions:[],cards:[],new_cards:[],due_cards:[]}));
  await harness(page,'MixedPage');
  await expect(page.getByText('没有可练习的题目，先去加词吧')).toBeVisible({timeout:2000});
  expect(errors).toEqual([]);
});

test('mixed recovery rejects malformed completion statistics',async({page})=>{
  const record={pending:{path:'/api/typing/check',payload:{card_id:1,submission_id:'old'}},items:[{type:'spell',q:{card_id:1,word:'apple',meaning:'苹果'}}],idx:0,stats:{correct:0,skipped:0,wrongList:[null],skippedList:[]},assistance:[],skipped:false};
  await page.addInitScript(r=>localStorage.setItem('ec.mixed.pending',JSON.stringify(r)),record);
  await page.route('**/api/**',route=>json(route,{questions:[],cards:[],new_cards:[],due_cards:[]}));
  await harness(page,'MixedPage');
  await expect(page.getByText('没有可练习的题目，先去加词吧')).toBeVisible({timeout:2000});
});

test('locally recovered delayed creation opens an already saved run',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('ec.delayed.day',JSON.stringify({id:'existing',purpose:'delayed_check',window:'day',pending_contact_ids:[]})));
  let creations=0;
  await page.route('**/api/**',async route=>{
    if(route.request().method()==='POST'){creations++;return json(route,{detail:'frozen request differs'},409);}
    return json(route,{id:'existing',purpose:'delayed_check',lifecycle:'active',items:[]});
  });
  await harness(page,'DelayedCheckPage',{window:'day'});
  await expect(page.getByRole('button',{name:'重新查找候选'})).toBeVisible({timeout:2000});
  expect(creations).toBe(0);
});

test('delayed creation still posts the frozen request when no run exists',async({page})=>{
  const pending={id:'new-run',purpose:'delayed_check',window:'day',pending_contact_ids:['unresolved-contact']};
  await page.addInitScript(p=>localStorage.setItem('ec.delayed.day',JSON.stringify(p)),pending);
  const requests=[];
  await page.route('**/api/**',async route=>{
    if(route.request().method()==='POST'){requests.push(route.request().postDataJSON());return json(route,{id:'new-run'});}
    if(!requests.length)return json(route,{detail:'not found'},404);
    return json(route,{id:'new-run',purpose:'delayed_check',lifecycle:'active',items:[]});
  });
  await harness(page,'DelayedCheckPage',{window:'day'});
  await expect(page.getByRole('button',{name:'重新查找候选'})).toBeVisible();
  expect(requests).toEqual([pending]);
});

test('feedback lookup can be explicitly recovered after leaving and reloading',async({page})=>{
  let lookup=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/cards')return ++lookup===1?json(route,{detail:'offline'},503):json(route,{cards:[{id:1,kind:'word',word:'apple',content_revision:revision}]});
    if(path==='/api/learning/contacts')return json(route,{detail:'offline'},503);
    return json(route,{});
  });
  await harness(page,'SceneFeedback',{session:scene,item:{id:'one',attempt_id:'attempt-one',feedback:feedback('one','An apple.')}});
  await expect(page.getByRole('button',{name:'继续确认接触',exact:true})).toBeVisible();
  await page.evaluate(()=>window.mount('Attempt'));
  await page.reload();await page.waitForFunction(()=>Boolean(window.mount));
  await page.evaluate(()=>window.mount('ContactRecovery'));
  await page.getByRole('button',{name:'继续确认反馈接触',exact:true}).click({timeout:2000});
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('ec.contact.lookup:scene-feedback:scene:one'))).toBeNull();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.contact.scene:answer_visible:1')))).toMatchObject({path:'/api/learning/contacts',payload:{card_id:1}});
});

test('feedback lookup memory recovery retains uncertainty until a target can persist',async({page})=>{
  await page.addInitScript(()=>{const nativeSet=Storage.prototype.setItem;window.restoreStorage=()=>Storage.prototype.setItem=nativeSet;Storage.prototype.setItem=()=>{throw new DOMException('blocked','QuotaExceededError');};});
  let lookup=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/cards')return ++lookup===1?json(route,{detail:'offline'},503):json(route,{cards:[{id:1,kind:'word',word:'apple',content_revision:revision}]});
    if(path==='/api/learning/contacts')return json(route,{detail:'offline'},503);
    return json(route,{});
  });
  await harness(page,'SceneFeedback',{session:scene,item:{id:'one',attempt_id:'attempt-one',feedback:feedback('one','An apple.')}});
  await expect(page.getByRole('button',{name:'继续确认接触',exact:true})).toBeVisible();
  await page.evaluate(()=>window.mount('ContactRecovery'));
  const retry=page.getByRole('button',{name:'继续确认反馈接触',exact:true});await retry.click();
  await expect(page.getByRole('alert')).toContainText('浏览器未能保存');
  await expect(retry).toBeEnabled();
  await page.evaluate(()=>window.restoreStorage());await retry.click();
  await expect(retry).toHaveCount(0,{timeout:2000});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.contact.scene:answer_visible:1')))).toMatchObject({path:'/api/learning/contacts',payload:{card_id:1}});
});

test('legacy feedback lookup without saved text stays honestly incomplete',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('ec.contact.lookup:scene-feedback:old:item',JSON.stringify({awaiting_targets:true})));
  await harness(page,'ContactRecovery');
  await expect(page.getByText('旧接触记录缺少反馈内容，接触依据仍不完整，请回到原反馈继续确认。')).toBeVisible();
  await expect(page.getByRole('button',{name:'继续确认反馈接触',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('ec.contact.lookup:scene-feedback:old:item'))).not.toBeNull();
});

test('practice retry preserves its pending answer against an in-flight skip',async({page})=>{
  let release;const barrier=new Promise(resolve=>release=resolve);const payloads=[];
  await page.route('**/api/typing/check',async route=>{
    payloads.push(route.request().postDataJSON());
    if(payloads.length===1)return json(route,{detail:'offline'},503);
    await barrier;await json(route,{committed:true,correct:true,expected:'apple'});
  });
  await harness(page,'Practice');await expect(page.getByText('ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.practice.submit('apple').catch(()=>{}));
  await page.evaluate(()=>{window.retrying=window.practice.retry();});
  await expect.poll(()=>payloads.length).toBe(2);
  await page.evaluate(()=>{window.skipping=window.practice.skip();});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.pending.typed-attempt')).payload.skipped)).toBe(false);
  release();await page.evaluate(()=>Promise.all([window.retrying,window.skipping]));
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
});

test('practice resumed confirmation preserves its answer against an in-flight skip',async({page})=>{
  const pending={path:'/api/typing/check',payload:{card_id:1,user_input:'apple',source:'spelling',kind:'typed',assistance:[],skipped:false,submission_id:'cf7b23bb-7e3d-4b74-b51f-6853b583fba4'}};
  await page.addInitScript(p=>localStorage.setItem('ec.pending.typed-attempt',JSON.stringify(p)),pending);
  let release;const barrier=new Promise(resolve=>release=resolve);const payloads=[];
  await page.route('**/api/typing/check',async route=>{payloads.push(route.request().postDataJSON());await barrier;await json(route,{committed:true,correct:true,expected:'apple'});});
  await harness(page,'Practice');await expect(page.getByText('ready',{exact:true})).toBeVisible();
  await page.evaluate(()=>{window.resuming=window.practice.resumePending();});
  await expect.poll(()=>payloads.length).toBe(1);
  await page.evaluate(()=>{window.skipping=window.practice.skip();});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ec.pending.typed-attempt')).payload.submission_id)).toBe(pending.payload.submission_id);
  release();await page.evaluate(()=>Promise.all([window.resuming,window.skipping]));
  expect(payloads).toEqual([pending.payload]);
});
