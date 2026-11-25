import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {inflateSync} from 'npm:fflate@0.8.2';
import {authenticateMaster,releaseService,releaseHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')||'';
const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if(!url||!secret)throw new Error('Configuração do servidor incompleta.');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{
 fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})
}});
const inflate=(bytes,size)=>inflateSync(bytes,{out:new Uint8Array(size)});
const service=releaseService(admin,inflate,url);
const origins=(Deno.env.get('GEOREDE_ADMIN_ALLOWED_ORIGINS')||'https://gnevesmt.github.io').split(',').map(s=>s.trim()).filter(Boolean);
origins.push('https://gneves-control.pages.dev');
Deno.serve(releaseHandler({authenticate:token=>authenticateMaster(admin,token),service},origins));
