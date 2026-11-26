import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../config.js',import.meta.url),'utf8');
for(const hostname of ['painel.gnevesmt.com.br','gneves-control.pages.dev','gnevesmt.github.io','preview.gneves-control.pages.dev','127.0.0.1']){
 test('deployment mode for '+hostname,()=>{
  const window={location:{hostname}};
  vm.runInNewContext(source,{window});
  assert.equal(window.GEOREDE_CONFIG.readOnlyPreview,!['painel.gnevesmt.com.br','gneves-control.pages.dev'].includes(hostname));
 });
}
