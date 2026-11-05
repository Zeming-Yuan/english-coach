import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-legacy-scripts-'));
const preload = path.join(dir, 'playwright.cjs');
fs.writeFileSync(preload, `const Module = require('node:module');
const original = Module._load;
const element = {isVisible: async()=>false, count: async()=>0, textContent: async()=>'', getAttribute: async()=>'', click: async()=>{}, fill: async()=>{}, first(){return this;}};
const page = {on(){}, goto: async()=>{if(process.env.EC_FAIL_GOTO) throw new Error('injected navigation failure');}, title: async()=>'', locator:()=>element, getByText:()=>element, waitForTimeout:async()=>{}, waitForFunction:async()=>{}, screenshot:async()=>{}};
Module._load = function(name, ...args) {
  if(name === 'playwright') return {chromium:{launch: async()=>({newPage:async()=>page,close:async()=>{}})}};
  return original.call(this,name,...args);
};`);
process.on('exit', () => fs.rmSync(dir, {recursive: true, force: true}));

test('legacy browser scripts return nonzero for failed checks and caught exceptions', () => {
  for (const file of ['e2e_test.js', 'e2e_story.js', 'lesson_e2e.js']) {
    for (const failure of ['', 'yes']) {
      const result = spawnSync(process.execPath, ['--require', preload, path.join(root, file)], {encoding:'utf8', timeout:5000, env:{...process.env, EC_FAIL_GOTO:failure}});
      assert.match(result.stdout, /❌/, `${file} did not exercise a failure`);
      assert.equal(result.status, 1, `${file} returned success after failure\n${result.stdout}\n${result.stderr}`);
    }
  }
});

test('screenshot demo already returns nonzero on an uncaught navigation failure', () => {
  const result = spawnSync(process.execPath, ['--require', preload, path.join(root, 'screenshot_demo.js')], {encoding:'utf8', timeout:5000, env:{...process.env, EC_FAIL_GOTO:'yes'}});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /injected navigation failure/);
});
