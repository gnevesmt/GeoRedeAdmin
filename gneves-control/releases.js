const $=s=>document.querySelector(s);
const text=(id,value)=>{$(id).textContent=value;};
const size=bytes=>(bytes/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' MB';
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
const statuses={ready:'Pronta para publicar',publishing:'Publicação em andamento',published:'Publicada',cancelled:'Cancelada',expired:'Preparação expirada'};
export function createReleasePanel(request){
 let allowed=false,busy=false,candidate=null,history=[];
 const file=$('#releaseFile'),notes=$('#releaseNotes'),publish=$('#publishRelease'),cancel=$('#cancelRelease');
 function message(value,bad=false){const el=$('#releaseMessage');el.textContent=value;el.className=bad?'danger':'success';el.hidden=!value;}
 function sync(){
  file.disabled=busy||!allowed;notes.disabled=busy||!candidate;publish.disabled=busy||!candidate||!notes.value.trim();
  cancel.disabled=busy||!candidate;$('#refreshReleases').disabled=busy;
  $('#releaseBusy').hidden=!busy;$('#releasePreview').hidden=!candidate;
 }
 function candidateView(metadata){
  text('#selectedVersion','Versão '+metadata.version_name);text('#selectedSize',size(metadata.size_bytes));
  text('#selectedCode',String(metadata.version_code));
  const versions={26:'8.0',27:'8.1',28:'9',29:'10',30:'11',31:'12',32:'12L',33:'13',34:'14',35:'15',36:'16'};
  text('#selectedAndroid','Android '+(versions[metadata.min_sdk]||'API '+metadata.min_sdk)+' ou superior');
 }
 function renderHistory(){
  const tbody=$('#releaseHistory');tbody.replaceChildren();
  if(!history.length){const row=tbody.insertRow();const cell=row.insertCell();cell.colSpan=4;cell.textContent='As próximas publicações aparecerão aqui.';return;}
  for(const item of history){
   const row=tbody.insertRow();row.insertCell().textContent=item.version_name;row.insertCell().textContent=statuses[item.status]||item.status;
   row.insertCell().textContent=date(item.published_at||item.created_at);
   const actions=row.insertCell();
   if(['ready','publishing'].includes(item.status)){
    const button=document.createElement('button');button.type='button';button.textContent=item.status==='publishing'?'Retomar publicação':'Continuar';
    button.onclick=()=>{candidate={id:item.id,metadata:item};notes.value=item.notes||'';candidateView(item);sync();$('#releasePreview').scrollIntoView({behavior:'smooth',block:'center'});};
    actions.append(button);
   }else actions.textContent=item.notes||'—';
  }
 }
 async function load(){
  if(!allowed||busy)return;
  busy=true;sync();
  try{
   const result=await request('list');text('#liveRelease',result.current.version_name);text('#liveReleaseSize',size(result.current.size_bytes));
   text('#liveReleaseNotes',result.current.notes||'');history=result.history||[];renderHistory();
   if(candidate&&history.some(r=>r.id===candidate.id&&r.status==='published')){candidate=null;notes.value='';file.value='';message('Atualização publicada. Os operadores serão avisados ao acessar online.');}
  }catch(error){message(error.message,true);}finally{busy=false;sync();}
 }
 file.onchange=async()=>{
  const apk=file.files[0];if(!apk||!allowed||busy)return;
  if(!apk.name.toLowerCase().endsWith('.apk')||apk.size>50*1024*1024||!apk.size){file.value='';message('Selecione um APK de até 50 MB.',true);return;}
  busy=true;message('Enviando o APK para conferir a versão, a assinatura e a integridade…');$('#releaseProgress').value=0;sync();
  try{
   if(candidate)await request('cancel',{id:candidate.id});candidate=null;notes.value='';
   const result=await request('analyze',{},apk,percent=>{$('#releaseProgress').value=percent;text('#releaseProgressLabel',percent<100?'Enviando arquivo: '+percent+'%':'Arquivo enviado. Conferindo assinatura e conteúdo…');});
   if(!result.eligible){message(result.message,true);file.value='';return;}
   candidate={id:result.id,metadata:result.metadata};candidateView(result.metadata);message('APK conferido. Agora descreva as melhorias desta versão.');notes.focus();
  }catch(error){candidate=null;file.value='';message(error.message,true);}finally{busy=false;sync();}
 };
 notes.oninput=sync;
 publish.onclick=()=>{
  if(busy||!candidate||!notes.value.trim())return;
  text('#confirmVersion','Publicar PontoGeo '+candidate.metadata.version_name+'?');text('#confirmReleaseNotes',notes.value.trim());
  $('#publishConfirm').showModal();
 };
 $('#closePublishConfirm').onclick=()=>$('#publishConfirm').close();
 $('#confirmPublish').onclick=async()=>{
  if(busy||!candidate||!allowed)return;
  $('#publishConfirm').close();busy=true;sync();message('Publicando e conferindo o download. Aguarde a confirmação…');
  try{
   const result=await request('publish',{id:candidate.id,notes:notes.value.trim()});
   candidate=null;notes.value='';file.value='';message(result.message||'Atualização publicada com sucesso.');
  }catch(error){message(error.message+' Se houve interrupção, use “Atualizar histórico” antes de tentar novamente.',true);}
  finally{busy=false;sync();await load();}
 };
 cancel.onclick=async()=>{
  if(!candidate||busy)return;busy=true;sync();
  try{await request('cancel',{id:candidate.id});candidate=null;file.value='';notes.value='';message('Preparação cancelada. A versão publicada permanece igual.');}
  catch(error){message(error.message,true);}finally{busy=false;sync();await load();}
 };
 $('#refreshReleases').onclick=load;
 window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
 sync();
 return{load,setAccess(value){allowed=value;if(!allowed){candidate=null;history=[];notes.value='';file.value='';$('#updatesTab').hidden=true;$('#updatesPanel').hidden=true;}sync();}};
}
