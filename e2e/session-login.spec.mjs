import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {test as base,expect,pythonBin} from './support/test.mjs';
import {readPort,stopChild} from './support/app.mjs';
const root=path.resolve(import.meta.dirname,'..');
const test=base.extend({
  gateway:async ({appFactory,playwright},use)=>{
    const owner=await appFactory(),friend=await appFactory();
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-auth-e2e-'));
    let child,request;
    try {
      const cert=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem')]);
      if(cert.status!==0)throw Error('Could not create disposable localhost TLS certificate');
      child=spawn(pythonBin(),['-m','e2e.support.gateway_server','--directory',directory,'--static',process.env.EC_STATIC_DIR||path.join(root,'app/static'),'--owner',owner.baseURL,'--friend',friend.baseURL],{cwd:root,stdio:['ignore','pipe','pipe']});
      let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
      const {port}=await readPort(child,()=>stderr);
      const baseURL=`https://127.0.0.1:${port}`;
      request=await playwright.request.newContext({baseURL,ignoreHTTPSErrors:true});
      for(let n=0;n<100;n++){
        try {if((await request.get('/auth/session')).ok())break;}catch{}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      await use({baseURL,owner,friend,request});
    }finally{await request?.dispose();if(child)await stopChild(child);fs.rmSync(directory,{recursive:true,force:true});}
  },
});
test.use({ignoreHTTPSErrors:true});
async function login(page,username,password){
  await page.getByLabel('用户名',{exact:true}).fill(username);
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录并开始学习',exact:true}).click();
}
test('session login shows errors, survives refresh and revokes logout',async({gateway,page,context})=>{
  await page.goto(gateway.baseURL);
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  await login(page,'owner','wrong');
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  await login(page,'owner','trial-password');
  await expect(page.getByLabel('当前账号')).toHaveText('owner');
  await expect(page.locator('.app.product-app')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('当前账号')).toHaveText('owner');
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-ec_session');
  expect(cookie.httpOnly&&cookie.secure).toBe(true);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  expect((await context.request.get(gateway.baseURL+'/api/stats')).status()).toBe(401);
});
test('switching accounts isolates pending records and AI settings',async({gateway,page})=>{
  await page.goto(gateway.baseURL);
  await login(page,'owner','trial-password');
  await expect(page.getByLabel('当前账号')).toHaveText('owner');
  await page.evaluate(()=>localStorage.setItem('ec.account.owner:ec.pending.study',JSON.stringify({path:'/api/reviews',payload:{submission_id:'owner-pending'}})));
  expect(await page.evaluate(async()=> (await fetch('/api/ai-config',{method:'PUT',headers:{'Content-Type':'application/json','X-EC-Account':'owner'},body:JSON.stringify({base_url:'http://127.0.0.1:9/v1',model:'owner-model',api_key:'disposable-key'})})).status)).toBe(200);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  await login(page,'friend1','friend-password');
  await expect(page.getByLabel('当前账号')).toHaveText('friend1');
  await expect(page.getByText('有一条学习记录尚未确认保存；刷新后可能需要重新核对。')).toHaveCount(0);
  expect((await page.evaluate(async()=> (await fetch('/api/ai-config',{headers:{'X-EC-Account':'friend1'}})).json())).has_key).toBe(false);
  expect(await page.evaluate(()=>localStorage.getItem('ec.account.owner:ec.pending.study'))).toContain('owner-pending');
});
test('cross-tab logout and stale identity cannot write into a different account',async({gateway,page,context})=>{
  await page.goto(gateway.baseURL);
  await login(page,'owner','trial-password');
  await expect(page.getByLabel('当前账号')).toHaveText('owner');
  const second=await context.newPage();await second.goto(gateway.baseURL);
  await expect(second.getByLabel('当前账号')).toHaveText('owner');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(second.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  await login(page,'friend1','friend-password');
  await expect(page.getByLabel('当前账号')).toHaveText('friend1');
  expect((await context.request.post(gateway.baseURL+'/api/cards/starter',{headers:{Origin:gateway.baseURL,'X-EC-Account':'owner'}})).status()).toBe(401);
  expect((await (await gateway.friend.request.get('/api/stats')).json()).total_cards).toBe(0);
  await second.close();
});
