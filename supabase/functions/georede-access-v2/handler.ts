/* Factory shared by the deployed Edge Function and local HTTP integration tests.
 * Roles are read from the DB; no role or actor supplied by the client is trusted. */
export function accessHandler(admin: any, allowedOrigins: string[]) {
 const origins = new Set(allowedOrigins);
 return async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string,string> = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
  if (origins.has(origin)) Object.assign(headers, {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'});
  const reply=(body: any,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if (origin && !origins.has(origin)) return reply({error:'Origem não autorizada.'},403);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply({error:'Método não permitido.'},405);
  const token=(req.headers.get('authorization')||'').match(/^Bearer (\S+)$/)?.[1];
  if(!token) return reply({error:'Faça login.'},401);
  try {
   const auth=await admin.auth.getUser(token);
   if(auth.error || !auth.data?.user) return reply({error:'Sessão inválida.'},401);
   let claims: any;
   try {claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return reply({error:'Sessão inválida.'},401);}
   if(!claims.session_id) return reply({error:'Sessão não verificável.'},401);
   const check=await admin.rpc('georede_access_session_valid',{p_user_id:auth.data.user.id,p_session_id:claims.session_id});
   if(check.error || check.data!==true) return reply({error:'Sessão revogada ou expirada.'},401);
   const body=await req.json();
   if(!body || typeof body!=='object' || Array.isArray(body)) return reply({error:'Requisição inválida.'},400);
   const actorId=auth.data.user.id;
   const call=async(action: string,payload: any)=>{
    const r=await admin.rpc('georede_access_admin',{p_action:action,p_payload:payload,p_actor_id:actorId});
    if(r.error) throw r.error;return r.data;
   };
   if(body.action==='clients') {
    const master=await admin.from('platform_admins').select('user_id').eq('user_id',actorId).maybeSingle();
    if(master.error) throw master.error;
    if(master.data){
     const [orgs,plans]=await Promise.all([admin.from('organizations').select('id,legal_name,trade_name,active').not('slug','like','qa-archived-%').order('legal_name'),admin.from('license_plans').select('id,name').eq('active',true)]);
     if(orgs.error||plans.error) throw orgs.error||plans.error;
     return reply({ok:true,role:'master',clients:orgs.data,plans:plans.data});
    }
    const membership=await admin.from('organization_members').select('organization_id,role,active,desktop_allowed').eq('user_id',actorId).eq('active',true).maybeSingle();
    if(membership.error) throw membership.error;
    if(!membership.data?.desktop_allowed||!['owner','admin'].includes(membership.data?.role))return reply({error:'Administrador Desktop necessário.'},403);
    const org=await admin.from('organizations').select('id,legal_name,trade_name,active').eq('id',membership.data.organization_id).single();
    if(org.error)throw org.error;
    return reply({ok:true,role:'client_admin',clients:[org.data],plans:[]});
   }
   if(body.action==='create_user') {
    const username=String(body.username||'').trim().toLowerCase(),fullName=String(body.full_name||'').trim();
    const password=typeof body.password==='string'?body.password:'';
    if(!/^[a-z0-9._-]{3,60}$/.test(username)||!fullName||fullName.length>120||password.length<8||password.length>512)return reply({error:'Informe nome, login válido e senha de 8 a 512 caracteres.'},400);
    // Internal Auth email is never returned or used as an authorization claim.
    const email=crypto.randomUUID()+'@login.georede.invalid';
    const payload={organization_id:body.organization_id,branch_id:body.branch_id,member_role:body.member_role,username,full_name:fullName,email};
    const reserve=await call('reserve_user',payload);let createdId: string|undefined;
    try{
     const creation=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{username,full_name:fullName,georede_provision_token:reserve.reservation_id},app_metadata:{georede_role:'operator',georede_active:true,access_provision_id:reserve.reservation_id}});
     if(creation.error||!creation.data?.user)throw creation.error||new Error('Falha no cadastro.');
     createdId=creation.data.user.id;
     await call('complete_user',{organization_id:body.organization_id,reservation_id:reserve.reservation_id,user_id:createdId});
     return reply({ok:true,message:'Usuário cadastrado.',user_id:createdId});
    }catch(error){
     // If completion committed but its response was lost, preserve the account.
     if(createdId){
      const membership=await admin.from('organization_members').select('user_id').eq('organization_id',body.organization_id).eq('user_id',createdId).maybeSingle();
      if(membership.data)return reply({ok:true,message:'Usuário cadastrado.',user_id:createdId});
      if(!membership.error)await admin.from('profiles').update({active:false}).eq('id',createdId);
     }
     try{await call('cancel_user',{organization_id:body.organization_id,reservation_id:reserve.reservation_id});}catch{/* Preserve reservation for audit and expiry if state is uncertain. */}
     throw error;
    }
   }
   if(body.action==='reset_password'){
    const password=typeof body.password==='string'?body.password:'';
    if(password.length<8||password.length>512)return reply({error:'Senha deve conter de 8 a 512 caracteres.'},400);
    const target={organization_id:body.organization_id,user_id:body.user_id};
    await call('authorize_password_reset',target);
    const changed=await admin.auth.admin.updateUserById(body.user_id,{password});
    if(changed.error)throw changed.error;
    await call('password_reset_done',target);
    return reply({ok:true,message:'Senha redefinida.'});
   }
   const actions=new Set(['dashboard','create_client','save_branch','set_rules','set_admin_branches','enable_client','set_client_active','save_user','approve_device','revoke_device']);
   if(!actions.has(body.action))return reply({error:'Ação inválida.'},400);
   return reply(await call(body.action,body));
  }catch(e: any){
   const status=e?.code==='42501'?403:['23505','23514'].includes(e?.code)?409:e instanceof SyntaxError||e?.code==='22023'?400:500;
   return reply({error:status===500?'Operação não concluída. Consulte o diagnóstico do servidor.':String(e?.message||'Operação recusada.')},status);
  }
 };
}
