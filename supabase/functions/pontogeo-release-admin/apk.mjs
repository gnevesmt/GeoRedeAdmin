// APK v2 signature verification and binary AndroidManifest inspection. No private key is used.
export const PACKAGE = 'br.com.georedebook';
export const CERTIFICATE = '61add6426a220e96b42a46ca06089e5563d79c0d9bcc37aeb5df96152c911d19';
export const MAX_APK = 50 * 1024 * 1024;
const encoder = new TextEncoder();
const utf8 = new TextDecoder('utf-8', {fatal:true});
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
export class ApkError extends Error {}
const fail = message => {throw new ApkError(message);};
const need = (value,message='APK inválido ou incompleto.') => {if(!value)fail(message);};
const equal = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
export const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256',bytes));
class Reader {
 constructor(bytes){this.b=bytes;this.p=0;this.d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
 u32(){need(this.p+4<=this.b.length);const n=this.d.getUint32(this.p,true);this.p+=4;return n;}
 lp(){const n=this.u32();need(n<=this.b.length-this.p);const b=this.b.subarray(this.p,this.p+n);this.p+=n;return b;}
 reader(){return new Reader(this.lp());}
 done(){need(this.p===this.b.length);}
}
function u32(b,p){need(p>=0&&p+4<=b.length);return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,true);}
function u16(b,p){need(p>=0&&p+2<=b.length);return new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(p,true);}
function u64(b,p){const lo=u32(b,p),hi=u32(b,p+4);need(hi===0,'APK ZIP64 não suportado.');return lo;}
function derNode(b,p=0){
 need(p+2<=b.length);const start=p,tag=b[p++];let n=b[p++];
 if(n&128){const count=n&127;need(count>0&&count<=4&&p+count<=b.length);n=0;for(let i=0;i<count;i++)n=n*256+b[p++];}
 need(n>=0&&p+n<=b.length);return{tag,start,body:p,end:p+n,bytes:b.subarray(start,p+n)};
}
function children(b,node){const result=[];let p=node.body;while(p<node.end){const c=derNode(b,p);need(c.end<=node.end);result.push(c);p=c.end;}return result;}
function certificateKey(certificate){
 const outer=derNode(certificate);need(outer.end===certificate.length&&outer.tag===0x30);
 const tbs=children(certificate,outer)[0];need(tbs?.tag===0x30);
 const fields=children(certificate,tbs),spki=fields[fields[0]?.tag===0xa0?6:5];need(spki?.tag===0x30);
 return spki.bytes;
}
function records(reader){const map=new Map();while(reader.p<reader.b.length){const r=reader.reader(),algorithm=r.u32(),data=r.lp();r.done();need(!map.has(algorithm));map.set(algorithm,data);}return map;}
function zipInfo(bytes){
 let eocd=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(bytes,p)===0x06054b50&&p+22+u16(bytes,p+20)===bytes.length){eocd=p;break;}
 need(eocd>=0);need(u16(bytes,eocd+4)===0&&u16(bytes,eocd+6)===0);
 const count=u16(bytes,eocd+10),cdSize=u32(bytes,eocd+12),cd=u32(bytes,eocd+16);
 need(count>0&&count!==65535&&u16(bytes,eocd+8)===count&&cd+cdSize===eocd);
 need(cd>=32&&utf8.decode(bytes.subarray(cd-16,cd))==='APK Sig Block 42','O arquivo precisa de assinatura APK v2 válida.');
 const blockSize=u64(bytes,cd-24),start=cd-blockSize-8;
 need(start>=0&&blockSize>=24&&u64(bytes,start)===blockSize);
 let p=start+8,v2;
 while(p<cd-24){const size=u64(bytes,p);p+=8;need(size>=4&&p+size<=cd-24);const id=u32(bytes,p);
  if(id===0x7109871a){need(!v2);v2=bytes.subarray(p+4,p+size);}p+=size;
 }
 need(p===cd-24&&v2,'O APK precisa ser assinado com APK Signature Scheme v2.');
 return{eocd,cd,cdSize,count,start,v2};
}
async function contentDigest(bytes,zip,algorithm){
 const eocd=Uint8Array.from(bytes.subarray(zip.eocd));new DataView(eocd.buffer).setUint32(16,zip.start,true);
 const sections=[bytes.subarray(0,zip.start),bytes.subarray(zip.cd,zip.eocd),eocd];const hashes=[];
 for(const section of sections)for(let offset=0;offset<section.length;offset+=1048576){
  const chunk=section.subarray(offset,Math.min(offset+1048576,section.length));const data=new Uint8Array(5+chunk.length);
  data[0]=0xa5;new DataView(data.buffer).setUint32(1,chunk.length,true);data.set(chunk,5);
  hashes.push(new Uint8Array(await crypto.subtle.digest(algorithm,data)));
 }
 const data=new Uint8Array(5+hashes.reduce((n,b)=>n+b.length,0));data[0]=0x5a;
 new DataView(data.buffer).setUint32(1,hashes.length,true);let offset=5;
 for(const hash of hashes){data.set(hash,offset);offset+=hash.length;}
 return new Uint8Array(await crypto.subtle.digest(algorithm,data));
}
async function verifySignature(bytes,zip){
 const outer=new Reader(zip.v2),signers=outer.reader();outer.done();const signer=signers.reader();signers.done();
 const signed=signer.lp(),signatures=records(signer.reader()),key=signer.lp();signer.done();
 const data=new Reader(signed),digests=records(data.reader()),certificates=data.reader();const cert=certificates.lp();
 while(certificates.p<certificates.b.length)certificates.lp();data.lp();need(data.b.length-data.p<=4096&&data.b.subarray(data.p).every(x=>x===0));
 need(await sha256(cert)===CERTIFICATE,'A assinatura não corresponde ao PontoGeo instalado nos clientes.');
 need(equal(key,certificateKey(cert)),'Chave pública do APK inconsistente.');
 need(signatures.size===digests.size&&[...signatures.keys()].every(k=>digests.has(k)));
 const id=[0x0102,0x0104,0x0101,0x0103].find(k=>signatures.has(k));need(id,'Algoritmo de assinatura não suportado.');
 const hash=[0x0102,0x0104].includes(id)?'SHA-512':'SHA-256',pss=[0x0101,0x0102].includes(id);
 const name=pss?'RSA-PSS':'RSASSA-PKCS1-v1_5';
 const publicKey=await crypto.subtle.importKey('spki',key,{name,hash},false,['verify']);
 need(await crypto.subtle.verify(pss?{name,saltLength:hash==='SHA-512'?64:32}:{name},publicKey,signatures.get(id),signed),
  'A assinatura criptográfica do APK é inválida.');
 need(equal(await contentDigest(bytes,zip,hash),digests.get(id)),'O conteúdo do APK foi alterado ou está incompleto.');
}
async function manifestBytes(bytes,zip,inflate){
 let p=zip.cd,found;
 for(let n=0;n<zip.count;n++){
  need(u32(bytes,p)===0x02014b50);const method=u16(bytes,p+10),size=u32(bytes,p+20),rawSize=u32(bytes,p+24);
  const nameSize=u16(bytes,p+28),extra=u16(bytes,p+30),comment=u16(bytes,p+32),local=u32(bytes,p+42);
  need(p+46+nameSize+extra+comment<=zip.eocd);
  const name=utf8.decode(bytes.subarray(p+46,p+46+nameSize));
  if(name==='AndroidManifest.xml'){
   need(!found&&!(u16(bytes,p+8)&1)&&rawSize<=524288&&size<=524288);
   need(u32(bytes,local)===0x04034b50&&u16(bytes,local+8)===method);
   const localName=u16(bytes,local+26),localExtra=u16(bytes,local+28);
   need(utf8.decode(bytes.subarray(local+30,local+30+localName))===name);
   const start=local+30+localName+localExtra;need(start+size<=zip.start);
   const compressed=bytes.subarray(start,start+size);
   found=method===0?compressed:method===8?await inflate(compressed,rawSize):fail('Compactação do APK não suportada.');
   need(found.length===rawSize);
  }
  p+=46+nameSize+extra+comment;
 }
 need(p===zip.eocd&&found,'AndroidManifest.xml não encontrado.');return found;
}
function stringPool(b,p,size){
 const count=u32(b,p+8),flags=u32(b,p+16),start=u32(b,p+20),header=u16(b,p+2);need(count<=30000&&header+count*4<=size);
 const strings=[];const len8=at=>{let n=b[at++];if(n&128)n=((n&127)<<8)|b[at++];return[n,at];};
 for(let i=0;i<count;i++){
  let at=p+start+u32(b,p+header+i*4);need(at>=p&&at<p+size);
  if(flags&0x100){let len;[,at]=len8(at);[len,at]=len8(at);need(at+len<p+size);strings.push(utf8.decode(b.subarray(at,at+len)));}
  else{let len=u16(b,at);at+=2;if(len&32768){len=((len&32767)<<16)|u16(b,at);at+=2;}need(at+len*2<p+size);strings.push(new TextDecoder('utf-16le').decode(b.subarray(at,at+len*2)));}
 }
 return strings;
}
function parseManifest(b){
 need(u16(b,0)===3&&u32(b,4)===b.length);let p=u16(b,2),strings,versionCode,versionName,packageName,minSdk=1;
 while(p<b.length){const type=u16(b,p),header=u16(b,p+2),size=u32(b,p+4);need(size>=header&&header>=8&&p+size<=b.length);
  if(type===1){need(!strings);strings=stringPool(b,p,size);}
  if(type===0x0102){need(strings&&header===16&&size>=36);const name=strings[u32(b,p+20)],count=u16(b,p+28),stride=u16(b,p+26);
   const start=p+16+u16(b,p+24);need(stride>=20&&count<=1000&&start+stride*count<=p+size);
   const attrs={};for(let i=0;i<count;i++){
    const a=start+i*stride,key=strings[u32(b,a+4)],ns=u32(b,a),raw=u32(b,a+8),kind=b[a+15],value=u32(b,a+16);
    const namespace=ns===0xffffffff?'':strings[ns];
    const result=kind===3?strings[value]:[16,17,18].includes(kind)?value:raw!==0xffffffff?strings[raw]:undefined;
    const qualified=namespace==='http://schemas.android.com/apk/res/android'?'android:'+key:namespace?'':key;
    if(qualified){need(!(qualified in attrs));attrs[qualified]=result;}
   }
   if(name==='manifest'){need(!packageName);packageName=attrs.package;versionCode=attrs['android:versionCode'];versionName=attrs['android:versionName'];need(!attrs['android:versionCodeMajor']);}
   if(name==='uses-sdk')minSdk=attrs['android:minSdkVersion']??1;
  }
  p+=size;
 }
 need(packageName===PACKAGE,'O arquivo não é um aplicativo PontoGeo.');
 need(Number.isInteger(versionCode)&&versionCode>0&&versionCode<=2147483647,'Número interno de versão inválido.');
 need(typeof versionName==='string'&&/^\d+\.\d+\.\d+$/.test(versionName)&&versionName.length<=50,'Nome de versão incompatível.');
 need(Number.isInteger(minSdk)&&minSdk>=26&&minSdk<=100,'Versão mínima de Android incompatível.');
 return{package_name:packageName,version_code:versionCode,version_name:versionName,min_sdk:minSdk};
}
export async function inspectApk(input,inflate){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 need(bytes.length>=100&&bytes.length<=MAX_APK,'Escolha um APK completo de até 50 MB.');
 const zip=zipInfo(bytes);await verifySignature(bytes,zip);
 const metadata=parseManifest(await manifestBytes(bytes,zip,inflate));
 return{...metadata,size_bytes:bytes.length,sha256:await sha256(bytes),certificate_sha256:CERTIFICATE};
}
