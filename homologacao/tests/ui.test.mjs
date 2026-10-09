import {createRequire} from 'node:module';import assert from 'node:assert/strict';import fs from 'node:fs';
const {createServer}=await import('node:http');const server=createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.split('?')[0].slice(1);if(!['index.html','app.js','config.js'].includes(name)){res.writeHead(404);res.end();return;}res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(new URL('../'+name,import.meta.url)));});await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
const {chromium}=await import('playwright');
// Exercise the approved existing host, with every HTTP request intercepted.
const backendUrl='https://uzsmsecjgmzlfdafyjai.supabase.co';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});let passed=0;
try{
for(const role of ['master','client_admin']){
 const page=await browser.newPage({viewport:{width:1440,height:1040}});const calls=[];
 const data={ok:true,role,organization:{id:'org',legal_name:'Cliente de Homologação'},rules:{enabled:true,offline_hours:72,replacement_limit:2,replacement_window_days:30},license:{current_period_end:'2026-12-31T23:59:00Z'},branches:[{id:'filial-a',name:'Confresa',active:true,used:1,mobile_limit:12}],users:[{user_id:'operator-a',full_name:'Equipe <A>',username:'equipe.a',role:'member',branch_id:'filial-a',active:true,profile_active:true}],devices:[{id:'pending-device',user_id:'operator-a',device_key:'synthetic-device-key',display_name:'Aparelho de teste',status:'pending',kind:'mobile'}],assignments:[],replacements:[{user_id:'operator-a'},{user_id:'operator-a'}]};
 await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.GEOREDE_CONFIG='+JSON.stringify({supabaseUrl:backendUrl,publishableKey:'test-publishable'})}));
 await page.route(backendUrl+'/**',async r=>{const q=r.request();if(q.method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});let body=q.postDataJSON(),payload;
  if(q.url().endsWith('/georede-access-login'))payload={access_token:'fake-test-token',refresh_token:'fake-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
  else{calls.push(body);if(body.action==='clients')payload={ok:true,role,clients:[{id:'org',legal_name:'Cliente de Homologação'}],plans:[{id:'plan',name:'Homologação'}]};else if(body.action==='dashboard')payload=data;else if(body.action==='create_user'){assert.equal(body.username,'equipe.b');assert.equal(body.branch_id,'filial-a');data.users.push({user_id:'operator-b',...body,role:'member',active:true,profile_active:true});data.branches[0].used++;payload={ok:true};}else if(body.action==='save_user'){Object.assign(data.users.find(u=>u.user_id===body.user_id),body);payload={ok:true};}else if(body.action==='save_branch'){data.branches[0].mobile_limit=+body.mobile_limit;payload={ok:true};}else payload={ok:true};}
  return r.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify(payload)});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8765');
 await page.locator('[name=login]').fill('teste');await page.locator('[name=password]').fill('testpassword');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#app').waitFor({state:'visible'});
 assert.equal(await page.locator('#offline').innerText(),'72 horas');assert.equal(await page.locator('#userRows b').first().innerText(),'Equipe <A>');passed++;
 await page.locator('#newUser').click();await page.locator('#editor [name=full_name]').fill('Equipe B');await page.locator('#editor [name=username]').fill('equipe.b');await page.locator('#editor [name=password]').fill('Testpass123');await page.locator('#editor button.primary').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(await page.locator('#userRows tr').count(),2);passed++;
 await page.locator('[data-edit-user="operator-b"]').click();await page.locator('#editor [name=full_name]').fill('Equipe B editada');await page.locator('#editor button.primary').click();await page.locator('#editor').waitFor({state:'hidden'});assert.ok((await page.locator('#userRows').innerText()).includes('Equipe B editada'));passed++;
 if(role==='master'){await page.locator('[data-tab=branches]').click();await page.locator('[data-edit-branch]').click();await page.locator('#editor [name=mobile_limit]').fill('15');await page.locator('#editor button.primary').click();await page.locator('#editor').waitFor({state:'hidden'});assert.ok((await page.locator('#branchRows').innerText()).includes('2 / 15'));passed++;await page.locator('[data-tab=users]').click();await page.screenshot({path:'GeoRedeAdmin-homologacao.png',fullPage:true});}
 else {assert.equal(await page.locator('#newClient').isVisible(),false);await page.locator('[data-tab=devices]').click();assert.equal(await page.getByRole('button',{name:'Exige Master'}).isDisabled(),true);passed++;}
 assert.deepEqual(errors,[]);await page.close();
}
{
 const page=await browser.newPage();let created=false;
 await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.GEOREDE_CONFIG='+JSON.stringify({supabaseUrl:backendUrl,publishableKey:'test-publishable'})}));
 await page.route(backendUrl+'/**',async r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
  const body=r.request().postDataJSON();let payload;
  if(r.request().url().endsWith('/georede-access-login'))payload={access_token:'synthetic-master',expires_at:Math.floor(Date.now()/1000)+3600};
  else if(body.action==='clients')payload={role:'master',clients:created?[{id:'new-client',legal_name:'Primeiro cliente'}]:[],plans:[{id:'plan',name:'GeoRede por filial'}]};
  else if(body.action==='create_client'){assert.equal(body.legal_name,'Primeiro cliente');assert.equal(body.plan_id,'plan');assert(!body.organization_id);created=true;payload={ok:true,organization_id:'new-client'};}
  else if(body.action==='dashboard')payload={rules:{enabled:true,offline_hours:72,replacement_limit:2,replacement_window_days:30},branches:[],users:[],devices:[],assignments:[],replacements:[]};
  else throw Error('Unexpected request in fresh-catalog test: '+body.action);
  return r.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify(payload)});
 });
 await page.goto('http://127.0.0.1:8765');await page.locator('[name=login]').fill('master.test');await page.locator('[name=password]').fill('SyntheticTest123');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#app').waitFor({state:'visible'});
 assert.equal(await page.locator('#newUser').isDisabled(),true);assert.equal(await page.locator('#newBranch').isDisabled(),true);
 await page.locator('#newClient').click();await page.locator('#editor [name=legal_name]').fill('Primeiro cliente');await page.locator('#editor [name=expires_at]').fill('2030-01-01T12:00');await page.locator('#editor button.primary').click();await page.locator('#editor').waitFor({state:'hidden'});
 assert.equal(created,true);assert.equal(await page.locator('#newUser').isEnabled(),true);assert.equal(await page.locator('#clientSelect').inputValue(),'new-client');passed++;
 await page.close();
}
console.log(passed+' browser flows passed (HTTP fixtures, not live Supabase).');fs.writeFileSync('ui-test-results.json',JSON.stringify({passed,auth:'HTTP fixtures',roles:['master','client_admin'],fresh_catalog:true},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
