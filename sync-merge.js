export const SHARED_META=['dna-profiles','dna-draft','workflows','workflow-draft','run-history'];
export function validateConfig(config){
  let url;try{url=new URL(config?.url);}catch{throw new Error('Enter the Supabase project URL.');}
  if(url.protocol!=='https:'||!/^([a-z0-9-]+)\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.search||url.hash)throw new Error('Use the HTTPS project URL from Supabase.');
  const key=config?.key?.trim();if(!key)throw new Error('Enter the Supabase publishable key.');if(key.startsWith('sb_secret_'))throw new Error('Use the publishable key. Secret keys must never go in the app.');
  if(!key.startsWith('sb_publishable_')){let payload;try{payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{throw new Error('Use a publishable key or the legacy anon key.');}if(payload.role!=='anon')throw new Error('Only the public anon key is accepted.');}
  return {url:url.origin,key};
}
export function mergeRecords(local,remote){
  const id=row=>row.kind+':'+row.record_id,remaining=new Map(remote.filter(row=>row.kind==='card'||(row.kind==='meta'&&SHARED_META.includes(row.record_id))).map(row=>[id(row),row])),uploads=[],downloads=[];
  for(const row of local){const other=remaining.get(id(row));if(!other||row.modified_ms>other.modified_ms)uploads.push(row);else if(other.modified_ms>row.modified_ms)downloads.push(other);remaining.delete(id(row));}
  downloads.push(...remaining.values());for(const row of downloads){if(!row.payload||typeof row.payload!=='object'||(row.kind==='card'&&row.payload.id!==row.record_id)||(row.kind==='meta'&&row.payload.key!==row.record_id))throw new Error('Invalid cloud record.');}
  return {uploads,downloads};
}
