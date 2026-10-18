import {backend} from './supabase.js';
export async function cleanup({env=process.env,fetcher=fetch}={}){
  const db=backend(env,fetcher);
  const expired=await db.table('collections','?delete_after=lte.'+encodeURIComponent(new Date().toISOString())+'&select=id&limit=200');
  let removed=0;
  for(const col of expired){
    // Remove blobs through Storage's API before deleting their database records.
    // This includes abandoned uploads and replaced, unfinished attempts.
    for(let batch=0;batch<100;batch++){
      const files=await db.call('/storage/v1/object/list/scout-packages',{method:'POST',body:{prefix:col.id+'/',limit:1000,offset:0}});
      if(!files.length)break;
      if(files.some(f=>!f.id||typeof f.name!=='string'||f.name.includes('/')))throw Error('Unexpected storage structure');
      await db.call('/storage/v1/object/scout-packages',{method:'DELETE',body:{prefixes:files.map(f=>col.id+'/'+f.name)}});
      if(batch===99)throw Error('Cleanup batch limit reached');
    }
    await db.table('collections','?id=eq.'+col.id,{method:'DELETE'});removed++;
  }
  await db.table('rate_limits','?started_at=lt.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString()),{method:'DELETE'});
  return {removed};
}
