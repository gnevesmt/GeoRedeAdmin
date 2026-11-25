import {inspectApk,sha256,PACKAGE,MAX_APK,ApkError} from './apk.mjs';
const CANDIDATES='pontogeo-release-candidates',PUBLIC='pontogeo-updates';
class HttpError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const check=(ok,message,status=400)=>{if(!ok)throw new HttpError(message,status);};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function db(result){if(result.error){const e=result.error;throw new HttpError(
 ['22023','23514','40001','42501'].includes(e.code)?e.message:'Operação não concluída. Atualize o histórico e tente novamente.',
 e.code==='42501'?403:e.code==='40001'?409:500);}return result.data;}
export async function authenticateMaster(admin,token){
 check(token,'Entre com seu login Master.',401);
 const identity=await admin.auth.getUser(token);check(!identity.error&&identity.data?.user,'Sessão inválida. Entre novamente.',401);
 const actor=identity.data.user.id;check(uuid(actor),'Sessão inválida.',401);
 let claims;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{throw new HttpError('Sessão inválida.',401);}
 check(uuid(claims.session_id),'Sessão não verificável.',401);
 check(db(await admin.rpc('georede_access_session_valid',{p_user_id:actor,p_session_id:claims.session_id}))===true,'Sessão revogada. Entre novamente.',401);
 const [profile,master]=await Promise.all([
  admin.from('profiles').select('active').eq('id',actor).maybeSingle(),
  admin.from('platform_admins').select('user_id').eq('user_id',actor).maybeSingle()
 ]);
 check(db(profile)?.active===true&&!!db(master),'Somente o Master ativo pode publicar atualizações.',403);
 return actor;
}
function metadataMatches(a,b){return ['package_name','version_code','version_name','sha256','size_bytes','min_sdk','certificate_sha256'].every(k=>a[k]===b[k]);}
export async function publishArtifact(row,io,inspect,baseUrl){
 const bytes=new Uint8Array(await io.loadPrivate());
 const verified=await inspect(bytes);check(metadataMatches({...row,package_name:PACKAGE},verified),'O arquivo preparado foi alterado. Selecione novamente o APK.');
 const path=row.version_name+'/PontoGeo_'+row.version_name+'.apk';
 await io.ensurePublic(path,bytes,row.sha256);
 const publicBytes=new Uint8Array(await io.readPublic(path));
 check(publicBytes.length===row.size_bytes&&await sha256(publicBytes)===row.sha256,'Falha na conferência do instalador. A atualização não foi anunciada.',503);
 const manifest={schema:1,enabled:true,package_name:PACKAGE,version_code:row.version_code,
  version_name:row.version_name,sha256:row.sha256,size_bytes:row.size_bytes,min_sdk:row.min_sdk,
  notes:row.notes,apk_url:baseUrl+'/storage/v1/object/public/'+PUBLIC+'/'+path};
 const latest=await io.readManifest();
 check(!latest||latest.version_code<row.version_code||latest.version_code===row.version_code&&latest.sha256===row.sha256,
  'Uma versão igual ou mais recente já foi publicada.',409);
 await io.writeManifest(manifest);
 const served=await io.readManifest();
 check(served?.version_code===row.version_code&&served.sha256===row.sha256&&served.apk_url===manifest.apk_url,
  'Não foi possível confirmar o aviso da atualização. Atualize o histórico.',503);
 return io.finish();
}
export function releaseService(admin,inflate,baseUrl){
 const inspect=async bytes=>{try{return await inspectApk(bytes,inflate);}catch(error){throw new HttpError(error instanceof ApkError?error.message:'Não foi possível conferir a assinatura e o conteúdo deste APK.');}};
 const storage=admin.storage;
 async function latest(){
  const {data,error}=await storage.from(PUBLIC).download('stable/latest.json');
  check(!error&&data,'Não foi possível ler a versão publicada.',503);
  const text=await data.text();check(text.length<=65536,'Aviso de versão inválido.',503);
  let value;try{value=JSON.parse(text);}catch{throw new HttpError('Aviso de versão inválido.',503);}
  check(value.schema===1&&value.package_name===PACKAGE&&Number.isInteger(value.version_code)&&value.version_code>0&&
   /^[0-9a-f]{64}$/.test(value.sha256)&&value.apk_url===baseUrl+'/storage/v1/object/public/'+PUBLIC+'/'+value.version_name+'/PontoGeo_'+value.version_name+'.apk',
   'Aviso de versão inválido.',503);
  return value;
 }
 async function cleanup(actor){
  const expired=db(await admin.from('mobile_app_releases').select('id,object_path').eq('actor_id',actor).eq('status','ready').lt('expires_at',new Date().toISOString()));
  for(const r of expired||[]){
   const updated=db(await admin.from('mobile_app_releases').update({status:'expired',updated_at:new Date().toISOString()}).eq('id',r.id).eq('status','ready').select('id'));
   if(updated?.length)await storage.from(CANDIDATES).remove([r.object_path]);
  }
 }
 async function own(actor,id){check(uuid(id),'Preparação inválida.');return db(await admin.from('mobile_app_releases').select('*').eq('id',id).eq('actor_id',actor).maybeSingle());}
 const finish=(actor,id)=>admin.rpc('pontogeo_release_finish',{p_actor_id:actor,p_release_id:id}).then(db);
 async function reconcile(actor,row,current){
  if(row?.status==='publishing'&&current.version_code===row.version_code&&current.sha256===row.sha256){
   const {data,error}=await storage.from(PUBLIC).download(row.version_name+'/PontoGeo_'+row.version_name+'.apk');
   check(!error&&data&&await sha256(new Uint8Array(await data.arrayBuffer()))===row.sha256,'Conferência da publicação pendente.',503);
   return finish(actor,row.id);
  }
  return row;
 }
 return {
  async list(actor){
   await cleanup(actor);const current=await latest();
   let rows=db(await admin.from('mobile_app_releases').select('*').or('status.eq.published,actor_id.eq.'+actor).order('created_at',{ascending:false}).limit(40))||[];
   for(let i=0;i<rows.length;i++)if(rows[i].actor_id===actor&&rows[i].status==='publishing')rows[i]=await reconcile(actor,rows[i],current);
   return{current,history:rows.map(({id,version_code,version_name,size_bytes,min_sdk,notes,status,created_at,updated_at,published_at,expires_at})=>
    ({id,version_code,version_name,size_bytes,min_sdk,notes,status,created_at,updated_at,published_at,expires_at}))};
  },
  async analyze(actor,bytes){
   await cleanup(actor);const metadata=await inspect(bytes),current=await latest();
   if(metadata.version_code<=current.version_code)return{metadata,current,eligible:false,message:'Esta versão já está publicada ou é anterior à versão disponível.'};
   const pending=db(await admin.from('mobile_app_releases').select('id').eq('actor_id',actor).eq('status','ready'))||[];
   check(pending.length<3,'Há preparações abertas. Cancele as anteriores antes de selecionar outro arquivo.',409);
   const id=crypto.randomUUID(),path=actor+'/'+id+'.apk';
   const upload=await storage.from(CANDIDATES).upload(path,bytes,{contentType:'application/vnd.android.package-archive',upsert:false,cacheControl:'0'});
   check(!upload.error,'Não foi possível guardar o arquivo para publicação.',503);
   try{const {package_name,...fields}=metadata;db(await admin.from('mobile_app_releases').insert({id,actor_id:actor,...fields,object_path:path}));}
   catch(error){await storage.from(CANDIDATES).remove([path]);throw error;}
   return{id,metadata,current,eligible:true,message:'Arquivo conferido. Descreva as melhorias para publicar.'};
  },
  async publish(actor,id,notes){
   check(typeof notes==='string'&&notes.trim().length>=1&&notes.length<=2000,'Descreva as melhorias em até 2000 caracteres.');
   const current=await latest();let row=await own(actor,id);check(row,'Preparação não encontrada.');
   row=await reconcile(actor,row,current);
   if(row.status==='published')return{release:row,current:await latest(),already_published:true};
   const reserved=db(await admin.rpc('pontogeo_release_begin',{p_release_id:id,p_actor_id:actor,p_notes:notes,p_observed_code:current.version_code}));
   row=reserved.release;
   if(reserved.done)return{release:row,current:await latest(),already_published:true};
   const release=await publishArtifact(row,{
    async loadPrivate(){const {data,error}=await storage.from(CANDIDATES).download(row.object_path);check(!error&&data,'Arquivo de preparação não encontrado. Atualize o histórico.',503);return data.arrayBuffer();},
    async ensurePublic(path,bytes,hash){
     const existing=await storage.from(PUBLIC).download(path);
     if(existing.data){check(await sha256(new Uint8Array(await existing.data.arrayBuffer()))===hash,'Já existe outro arquivo para esta versão. Não foi substituído.',409);return;}
     check(!existing.error||String(existing.error.statusCode||existing.error.status)==='404'||String(existing.error.message).toLowerCase().includes('not found'),'Falha ao consultar o instalador.',503);
     const result=await storage.from(PUBLIC).upload(path,bytes,{contentType:'application/vnd.android.package-archive',upsert:false,cacheControl:'31536000'});
     check(!result.error,'Não foi possível enviar o instalador. Atualize o histórico antes de tentar novamente.',503);
    },
    async readPublic(path){const {data,error}=await storage.from(PUBLIC).download(path);check(!error&&data,'Não foi possível conferir o instalador.',503);return data.arrayBuffer();},
    readManifest:latest,
    async writeManifest(manifest){const result=await storage.from(PUBLIC).upload('stable/latest.json',JSON.stringify(manifest),{contentType:'application/json',upsert:true,cacheControl:'0'});check(!result.error,'Não foi possível anunciar a atualização. Atualize o histórico.',503);},
    finish:()=>finish(actor,id)
   },inspect,baseUrl);
   await storage.from(CANDIDATES).remove([row.object_path]);
   return{release,current:await latest(),message:'Atualização publicada. Os operadores serão avisados ao acessar online.'};
  },
  async cancel(actor,id){
   const row=await own(actor,id);check(row?.status==='ready','Só é possível cancelar uma preparação ainda não publicada.',409);
   const changed=db(await admin.from('mobile_app_releases').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',id).eq('actor_id',actor).eq('status','ready').select('id'));
   check(changed?.length,'A publicação já foi iniciada.',409);await storage.from(CANDIDATES).remove([row.object_path]);return{message:'Preparação cancelada.'};
  }
 };
}
export function releaseHandler({authenticate,service},allowedOrigins){
 const origins=new Set(allowedOrigins);
 return async req=>{
  const origin=req.headers.get('origin')||'';const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
  if(origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'});
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply({error:'Origem não autorizada.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  try{
   const token=(req.headers.get('authorization')||'').match(/^Bearer (\S+)$/)?.[1];
   const actor=await authenticate(token);
   const action=new URL(req.url).searchParams.get('action');
   if(action==='analyze'){
    const size=Number(req.headers.get('content-length'));check(!size||size<=MAX_APK,'Escolha um APK de até 50 MB.',413);
    const reader=req.body?.getReader();check(reader,'Escolha um APK.');const chunks=[];let total=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;check(total<=MAX_APK,'APK maior que 50 MB.',413);chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    return reply({ok:true,...await service.analyze(actor,bytes)});
   }
   check(Number(req.headers.get('content-length')||0)<=10000,'Requisição muito grande.',413);
   const text=await req.text();check(text.length<=10000,'Requisição muito grande.',413);let body;
   try{body=JSON.parse(text);}catch{throw new HttpError('Requisição inválida.');}
   check(body&&typeof body==='object'&&!Array.isArray(body),'Requisição inválida.');
   if(body.action==='list')return reply({ok:true,...await service.list(actor)});
   if(body.action==='publish')return reply({ok:true,...await service.publish(actor,body.id,body.notes)});
   if(body.action==='cancel')return reply({ok:true,...await service.cancel(actor,body.id)});
   throw new HttpError('Ação inválida.');
  }catch(error){return reply({error:error instanceof HttpError?error.message:'Não foi possível conferir ou publicar o arquivo. Atualize o histórico e tente novamente.'},error.status||400);}
 };
}
