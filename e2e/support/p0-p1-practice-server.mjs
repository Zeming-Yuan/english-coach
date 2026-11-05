import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import path from 'node:path';

// Run the actual source components without compiling the whole frontend.
export async function startPracticeServer() {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const frontend=path.join(root,'frontend');
  const require=createRequire(path.join(frontend,'package.json'));
  const {createServer}=await import(pathToFileURL(require.resolve('vite')));
  const dependencies=realpathSync(path.join(frontend,'node_modules'));
  const server=await createServer({
    configFile:false,
    root:frontend,
    resolve:{alias:{react:path.join(dependencies,'react'),'react-dom':path.join(dependencies,'react-dom')}},
    server:{host:'127.0.0.1',port:0,fs:{allow:[root,dependencies]}},
  });
  await server.listen();
  return server;
}
