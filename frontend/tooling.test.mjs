import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'vite';

const frontend = fileURLToPath(new URL('./', import.meta.url));

test('clean succeeds on a fresh checkout and only removes generated entry scripts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ec-clean-'));
  try {
    const cwd = path.join(root, 'frontend');
    await fs.mkdir(cwd);
    await fs.copyFile(path.join(frontend, 'package.json'), path.join(cwd, 'package.json'));
    const run = () => spawnSync('npm', ['run', 'clean'], {cwd, encoding: 'utf8'});
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const assets = path.join(root, 'app/static/assets');
    await fs.mkdir(assets, {recursive: true});
    for (const name of ['index-old.js', 'other.js', 'index-style.css']) await fs.writeFile(path.join(assets, name), 'keep');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await fs.readdir(assets)).sort(), ['index-style.css', 'other.js']);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('development serves its module and HMR client at the production static base', async () => {
  const server = await createServer({root: frontend, configFile: path.join(frontend, 'vite.config.js'), server: {host: '127.0.0.1', port: 0}});
  try {
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
    let clientSource;
    for (const resource of ['@vite/client', 'src/main.jsx']) {
      const response = await fetch(origin + '/' + resource);
      const body = await response.text();
      assert.equal(response.status, 200, `${resource}: ${body}`);
      if (resource === '@vite/client') clientSource = body;
    }
    const token = clientSource.match(/const wsToken = (.*);/)[1];
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/?token=' + JSON.parse(token), 'vite-hmr');
    try {
      const message = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('HMR did not connect')), 3000);
        socket.addEventListener('message', e => {clearTimeout(timer); resolve(JSON.parse(e.data));}, {once: true});
        socket.addEventListener('error', e => {clearTimeout(timer); reject(e.error || new Error('HMR connection failed'));}, {once: true});
      });
      assert.equal(message.type, 'connected');
    } finally {await new Promise(resolve => {socket.addEventListener('close', resolve, {once: true}); socket.close();});}
  } finally {await server.close();}
});

test('development keeps backend images, CSS and favicon while serving its own index', async () => {
  const {createServer: httpServer} = await import('node:http');
  const {loadConfigFromFile} = await import('vite');
  const paths = {'/static/images/home-reading.png':['images/home-reading.png','image/png'], '/static/style.css':['style.css','text/css'], '/static/favicon.svg':['favicon.svg','image/svg+xml']};
  const backend = httpServer(async (req,res) => {
    const resource = paths[new URL(req.url,'http://localhost').pathname];
    if (!resource) {res.writeHead(404); res.end(); return;}
    const bytes = await fs.readFile(path.join(frontend,'../app/static',resource[0]));
    res.writeHead(200, {'content-type':resource[1]}); res.end(bytes);
  });
  await new Promise(resolve => backend.listen(0,'127.0.0.1',resolve));
  let server;
  try {
    const {config} = await loadConfigFromFile({command:'serve',mode:'development'},path.join(frontend,'vite.config.js'));
    const target = `http://127.0.0.1:${backend.address().port}`;
    const proxy = Object.fromEntries(Object.keys(config.server.proxy).map(key => [key,target]));
    server = await createServer({...config,configFile:false,root:frontend,server:{...config.server,proxy,host:'127.0.0.1',port:0}});
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/,'');
    const image = await fetch(origin+'/images/home-reading.png');
    assert.match(image.headers.get('content-type'),/^image\/png/);
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
    for (const [resource, type] of [['style.css?v=11','text/css'],['favicon.svg','image/svg+xml']]) {
      const response = await fetch(origin+'/'+resource);
      assert.equal(response.status,200);
      assert.ok(response.headers.get('content-type').startsWith(type));
    }
    for (const entry of ['/', '/index.html', '/index.html?reload=1']) {
      const index = await fetch(origin+entry);
      assert.equal(index.status,200,entry);
      assert.match(await index.text(),/\/static\/src\/main.jsx/);
    }
  } finally {
    if (server) await server.close();
    await new Promise(resolve=>backend.close(resolve));
  }
});
