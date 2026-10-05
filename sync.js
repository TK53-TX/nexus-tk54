import {listObjects,listAttachments,listMeta,readMeta,writeMeta,saveBundle,saveMeta} from './store.js';
import {mergeRecords,SHARED_META,validateConfig} from './sync-merge.js';
let cloud=null,user=null,notify=()=>{},syncing=false,applying=false,pending=false,scheduled,autoSync=false,loading;
const BUCKET='nexus-attachments';
async function loadLibrary(){
  if(window.supabase)return window.supabase;
  if(!loading)loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.js';
    script.onload=()=>window.supabase?resolve(window.supabase):reject(new Error('Supabase library could not load.'));
    script.onerror=()=>{script.remove();loading=null;reject(new Error('Connect to the internet to configure cloud sync.'));};
    document.head.append(script);
  });
  return loading;
}
function report(text){notify(text);window.dispatchEvent(new CustomEvent('nexus:cloud-state',{detail:{text,signedIn:!!user,configured:!!cloud}}));}
export async function connectSupabase(config,onStatus){
  const valid=validateConfig(config);notify=onStatus||notify;
  if(cloud){if(cloud.url!==valid.url)throw new Error('Reload before changing projects.');report(user?'Signed in · ready to sync':'Project connected · sign in by email');return;}
  const response=await fetch(valid.url+'/auth/v1/settings',{headers:{apikey:valid.key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Project connection failed. Check the publishable key and project status.');
  const library=await loadLibrary();
  const client=library.createClient(valid.url,valid.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  cloud={client,url:valid.url};
  client.auth.onAuthStateChange((_event,session)=>{
    user=session?.user||null;report(user?'Signed in · ready to sync':'Project connected · sign in by email');
    if(user)queueMicrotask(async()=>{autoSync=(await readMeta('sync-owner'))?.value===user.id;if(autoSync)schedule();});else autoSync=false;
  });
  const {data,error}=await client.auth.getSession();if(error)throw error;
  user=data.session?.user||null;autoSync=!!user&&(await readMeta('sync-owner'))?.value===user.id;
  report(user?'Signed in · ready to sync':'Project connected · sign in by email');
}
export async function sendSignInLink(email){
  if(!cloud)throw new Error('Connect the project first.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter your email address.');
  const {error}=await cloud.client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  if(error)throw error;report('Check your email. Open the sign-in link on this device.');
}
export async function signOut(){if(syncing)throw new Error('Wait for sync to finish.');if(cloud){const {error}=await cloud.client.auth.signOut();if(error)throw error;}autoSync=false;report('Signed out · local work remains on this device');}
export async function runCloudAI(input,signal){
  if(!cloud||!user)throw new Error('Sign in to Supabase before a hosted AI run.');
  const {data,error}=await cloud.client.auth.getSession();if(error)throw error;
  const response=await fetch(cloud.url+'/functions/v1/nexus-ai',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({input}),signal});
  const result=await response.json().catch(()=>({error:'Hosted AI is not configured yet.'}));if(!response.ok)throw new Error(result.error||'Hosted AI is not configured yet.');return result;
}
async function fetchRecords(uid){const rows=[];for(let offset=0;;offset+=1000){const {data,error}=await cloud.client.from('nexus_records').select('*').eq('owner_id',uid).order('kind').order('record_id').range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}}
export async function syncSupabase(){
  if(syncing){pending=true;return;}if(!cloud||!user)throw new Error('Sign in before syncing.');if(!navigator.onLine)throw new Error('You are offline. Your changes are saved on this device.');
  const uid=user.id;
  syncing=true;pending=false;const ensureUser=()=>{if(user?.id!==uid)throw new Error('Sign-in changed. Sync stopped.');};
  try{
    const previous=(await readMeta('sync-owner'))?.value;if(previous&&previous!==uid)throw new Error('This device is linked to another account. Use a separate browser profile to keep accounts separate.');
    report('Syncing cards and studio settings…');
    const remote=await fetchRecords(uid),localCards=await listObjects(),localMeta=await listMeta(),files=await listAttachments();ensureUser();
    const local=[...localCards.map(payload=>({owner_id:uid,kind:'card',record_id:payload.id,payload,modified_ms:payload.updatedAt||0})),...localMeta.filter(record=>SHARED_META.includes(record.key)).map(payload=>({owner_id:uid,kind:'meta',record_id:payload.key,payload,modified_ms:payload.updatedAt||0}))];
    const {uploads,downloads}=mergeRecords(local,remote);
    for(let i=0;i<uploads.length;i+=100){ensureUser();const {error}=await cloud.client.from('nexus_records').upsert(uploads.slice(i,i+100),{onConflict:'owner_id,kind,record_id'});if(error)throw error;}
    const currentCards=new Map((await listObjects()).map(card=>[card.id,card])),currentMeta=new Map((await listMeta()).map(record=>[record.key,record]));
    const newCards=downloads.filter(row=>row.kind==='card'&&(!currentCards.has(row.record_id)||(currentCards.get(row.record_id).updatedAt||0)<row.modified_ms));
    const newMeta=downloads.filter(row=>row.kind==='meta'&&(!currentMeta.has(row.record_id)||(currentMeta.get(row.record_id).updatedAt||0)<row.modified_ms));
    ensureUser();applying=true;try{if(newCards.length)await saveBundle(newCards.map(row=>row.payload));for(const row of newMeta)await saveMeta(row.payload);}finally{applying=false;}
    report('Syncing attached files…');const remoteFiles=new Map(remote.filter(row=>row.kind==='file').map(row=>[row.record_id,row.payload]));
    for(const file of files){ensureUser();if(remoteFiles.has(file.id)){remoteFiles.delete(file.id);continue;}if(file.blob.size>20*1024*1024)throw new Error('Attachment exceeds 20 MB: '+file.name);
      const path=uid+'/'+file.id;const {error}=await cloud.client.storage.from(BUCKET).upload(path,file.blob,{contentType:file.type||'application/octet-stream',upsert:true});if(error)throw error;
      const payload={id:file.id,name:file.name,type:file.type,path,addedAt:file.addedAt||0};ensureUser();const result=await cloud.client.from('nexus_records').upsert({owner_id:uid,kind:'file',record_id:file.id,payload,modified_ms:file.addedAt||0},{onConflict:'owner_id,kind,record_id'});if(result.error)throw result.error;
    }
    for(const file of remoteFiles.values()){ensureUser();if(file.path!==uid+'/'+file.id)throw new Error('Invalid attachment path.');const {data,error}=await cloud.client.storage.from(BUCKET).download(file.path);if(error)throw error;if(data.size>20*1024*1024)throw new Error('Attachment exceeds 20 MB.');ensureUser();applying=true;try{await saveBundle([],[{...file,blob:data}]);}finally{applying=false;}}
    ensureUser();applying=true;try{await writeMeta('sync-owner',uid);}finally{applying=false;}autoSync=true;report('Synced · '+new Date().toLocaleTimeString());window.dispatchEvent(new Event('studio:refresh'));
  }catch(error){report('Sync pending · '+error.message);throw error;}
  finally{syncing=false;if(pending)schedule();}
}
function schedule(){if(applying||!autoSync||!user)return;if(syncing){pending=true;return;}clearTimeout(scheduled);scheduled=setTimeout(()=>syncSupabase().catch(()=>{}),2000);}
window.addEventListener('nexus:local-change',schedule);window.addEventListener('online',schedule);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule();});setInterval(()=>{if(document.visibilityState==='visible')schedule();},60000);
