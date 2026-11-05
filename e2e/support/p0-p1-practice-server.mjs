import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Run the actual source components without compiling the whole frontend.
export async function startPracticeServer() {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const frontend=path.join(root,'frontend');
  const require=createRequire(path.join(frontend,'package.json'));
  const {createServer}=await import(pathToFileURL(require.resolve('vite')));
  const dependencies=realpathSync(path.join(frontend,'node_modules'));
  const cacheDir=mkdtempSync(path.join(os.tmpdir(),'ec-practice-source-'));
  const server=await createServer({
    configFile:false,
    root:frontend,
    cacheDir,
    resolve:{alias:{react:path.join(dependencies,'react'),'react-dom':path.join(dependencies,'react-dom')}},
    server:{host:'127.0.0.1',port:0,fs:{allow:[root,dependencies]}},
  });
  await server.listen();
  return {
    resolvedUrls: server.resolvedUrls,
    async close() {
      try {await server.close();}
      finally {rmSync(cacheDir,{recursive:true,force:true});}
    },
  };
}
