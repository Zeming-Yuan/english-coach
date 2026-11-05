import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const moduleURL = new URL('./app.mjs', import.meta.url).href;
const staticDir = new URL('../../app/static', import.meta.url).pathname;
const python = process.env.EC_PYTHON || new URL('../../.venv/bin/python', import.meta.url).pathname;

function run(body, setup = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-lifecycle-'));
  try {
    setup(dir);
    const code = `import assert from 'node:assert/strict'; import fs from 'node:fs';
      import {startApp} from ${JSON.stringify(moduleURL)};
      ${body}
      assert.deepEqual(fs.readdirSync(process.env.TMPDIR).filter(n => n.startsWith('ec-e2e-')), []);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      timeout: 15000, encoding: 'utf8', env: {...process.env, TMPDIR: dir, EC_STATIC_DIR: staticDir, EC_PYTHON: python},
    });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr}\n${result.stdout}`);
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
}

test('failed seed or snapshot removes its temporary application directory', () => {
  run(`await assert.rejects(startApp({fixture: 'missing-fixture.json'}), /seed.py failed/);`);
  run(`await assert.rejects(startApp({snapshotOf: '/nonexistent/ec-snapshot.db'}), /snapshot failed/);`);
});

test('failed server spawn rejects promptly and removes its directory', () => {
  run(`process.env.EC_PYTHON = process.env.TMPDIR + '/disappearing-python';
    await assert.rejects(startApp(), /ENOENT/);`, dir => {
    const file = path.join(dir, 'disappearing-python');
    fs.writeFileSync(file, '#!/usr/bin/env node\nrequire("node:fs").unlinkSync(process.argv[1]);\n', {mode: 0o755});
  });
});

test('request disposal failure still stops the server and removes its directory', () => {
  run(`const app = await startApp();
    assert.equal((await app.request.get('/api/health')).status(), 200);
    app.request.dispose = async () => {throw new Error('dispose failed');};
    await assert.rejects(app.close(), /dispose failed/);
    await assert.rejects(fetch(app.baseURL + '/api/health'));`);
});

test('closing a group attempts every application even when one close fails', () => {
  const code = `import assert from 'node:assert/strict';
    import {closeApps} from ${JSON.stringify(moduleURL)};
    const seen = [];
    await assert.rejects(closeApps([
      {close: async () => {seen.push('first');}},
      {close: async () => {seen.push('second'); throw new Error('close failed');}},
      {close: async () => {seen.push('third');}},
    ]), /cleanup/);
    assert.deepEqual(seen, ['third', 'second', 'first']);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
