import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseHTML} from 'linkedom';import {createReleasePanel} from '../releases.js';
const metadata={version_name:'1.9.117',version_code:137,size_bytes:16000000,min_sdk:26};
function setup(options={}){
 const {document,window}=parseHTML(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
 globalThis.document=document;globalThis.window=window;
 window.HTMLElement.prototype.scrollIntoView=()=>{};
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};}
 const tbody=document.querySelector('#releaseHistory');tbody.insertRow=()=>{const row=document.createElement('tr');tbody.append(row);row.insertCell=()=>{const cell=document.createElement('td');row.append(cell);return cell;};return row;};
 const calls=[];let current={version_name:'1.9.116',version_code:136,size_bytes:16025775,notes:'Atual'},history=[];
 const request=async(action,body={},file,progress)=>{
  calls.push({action,body});if(options[action])return options[action](body,file,progress);
  if(action==='list')return{current,history};
  if(action==='analyze'){progress(100);return{id:'candidate-1',eligible:true,metadata,current};}
  if(action==='publish'){current={...metadata,notes:body.notes};history=[{id:body.id,...metadata,status:'published',notes:body.notes}];return{message:'Atualização publicada.'};}
  if(action==='cancel')return{};
 };
 const panel=createReleasePanel(request),$=s=>document.querySelector(s);
 const select=async(file={name:'release.apk',size:16000000})=>{Object.defineProperty($('#releaseFile'),'files',{value:[file],configurable:true});await $('#releaseFile').onchange();};
 return{document,window,$,panel,calls,select};
}
test('non-Master never loads releases or enables publishing',async()=>{
 const s=setup();s.panel.setAccess(false);await s.panel.load();assert.equal(s.calls.length,0);assert.equal(s.$('#publishRelease').disabled,true);assert.equal(s.$('#updatesTab').hidden,true);
});
test('Master loads current version and prepares APK automatically',async()=>{
 const s=setup();s.panel.setAccess(true);await s.panel.load();assert.equal(s.$('#liveRelease').textContent,'1.9.116');await s.select();
 assert.equal(s.$('#selectedVersion').textContent,'Versão 1.9.117');assert.equal(s.$('#releasePreview').hidden,false);
 assert.equal(s.$('#publishRelease').disabled,true);s.$('#releaseNotes').value='Correções de fotos';s.$('#releaseNotes').oninput();assert.equal(s.$('#publishRelease').disabled,false);
});
test('publication requires explicit confirmation and refreshes visible status',async()=>{
 const s=setup();s.panel.setAccess(true);await s.select();s.$('#releaseNotes').value='Melhorias';s.$('#releaseNotes').oninput();s.$('#publishRelease').onclick();
 assert.equal(s.$('#publishConfirm').open,true);assert.equal(s.calls.some(c=>c.action==='publish'),false);
 await s.$('#confirmPublish').onclick();assert.equal(s.$('#liveRelease').textContent,'1.9.117');assert.equal(s.$('#publishRelease').disabled,true);
 assert.equal(s.calls.find(c=>c.action==='publish').body.notes,'Melhorias');
});
test('old APK never enables publication',async()=>{
 const s=setup({analyze:async()=>({eligible:false,message:'Esta versão já está publicada.'})});s.panel.setAccess(true);await s.select();
 assert.equal(s.$('#publishRelease').disabled,true);assert.match(s.$('#releaseMessage').textContent,/já está publicada/);
});
test('rejects oversize and non-APK files before network upload',async()=>{
 const s=setup();s.panel.setAccess(true);await s.select({name:'bad.apk',size:52428801});await s.select({name:'photo.jpg',size:100});assert.equal(s.calls.length,0);
});
test('cancel preserves live version and clears preparation',async()=>{
 const s=setup();s.panel.setAccess(true);await s.select();await s.$('#cancelRelease').onclick();assert.equal(s.$('#releasePreview').hidden,true);assert.equal(s.$('#liveRelease').textContent,'1.9.116');assert.equal(s.calls.some(c=>c.action==='cancel'),true);
});
test('network failure never reports a new version as published',async()=>{
 const s=setup({publish:async()=>{throw Error('Conexão interrompida');}});s.panel.setAccess(true);await s.select();s.$('#releaseNotes').value='Melhorias';
 await s.$('#confirmPublish').onclick();assert.equal(s.$('#liveRelease').textContent,'1.9.116');assert.match(s.$('#releaseMessage').textContent,/interrompida/);assert.equal(s.$('#releasePreview').hidden,false);
});
test('notes in confirmation are text, never interpreted as markup',async()=>{
 const s=setup();s.panel.setAccess(true);await s.select();s.$('#releaseNotes').value='<img src=x onerror=alert(1)>';s.$('#publishRelease').onclick();
 assert.equal(s.$('#confirmReleaseNotes img'),null);assert.match(s.$('#confirmReleaseNotes').textContent,/<img/);
});
