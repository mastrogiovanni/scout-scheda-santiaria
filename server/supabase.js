export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export function backend(env=process.env,fetcher=fetch){
  const url=env.SUPABASE_URL?.replace(/\/$/,'');const key=env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new HttpError(503,'La raccolta online non è ancora configurata. Puoi conservare e scaricare lo ZIP.');
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(parsed.hostname))throw new HttpError(503,'Configurazione del servizio non valida.');
  async function call(path,{method='GET',body,headers={},raw=false}={}){
    const response=await fetcher(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    if(!response.ok){let detail={};try{detail=await response.json();}catch{}
      const known={invalid_invitation:'Invito non valido o revocato.',closed_collection:'La raccolta è chiusa o scaduta.',invitation_limit:'Massimo 400 inviti per raccolta.',already_delivered:'Questo invito è già stato utilizzato. Per una correzione chiedi un nuovo invito al capo.',upload_changed:'Il pacchetto è cambiato durante l’invio. Riprova.'};
      if(known[detail.message])throw new HttpError(409,known[detail.message]);
      if(path.startsWith('/auth/'))throw new HttpError(401,'Accesso non riuscito o link scaduto. Richiedi un nuovo link nello stesso browser.');
      throw new HttpError(response.status===404?404:502,'Servizio temporaneamente non disponibile. Riprova; la consegna non è confermata.');
    }
    if(raw)return response;
    return response.status===204?null:response.json();
  }
  const table=(name,query='',options={})=>call('/rest/v1/scout_'+name+query,{...options,headers:{Prefer:'return=representation',...options.headers}});
  const rpc=(name,body)=>call('/rest/v1/rpc/scout_'+name,{method:'POST',body});
  const object=path=>'/storage/v1/object/scout-packages/'+path;
  async function download(path,max){
    const response=await call(object(path),{raw:true});
    if(Number(response.headers.get('content-length'))>max)throw new HttpError(422,'Pacchetto troppo grande.');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new HttpError(422,'Pacchetto troppo grande.');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  async function signed(path,upload=false){
    const result=await call('/storage/v1/object/'+(upload?'upload/sign/':'sign/')+'scout-packages/'+path,{method:'POST',body:upload?{}:{expiresIn:60}});
    const link=result.url||result.signedURL;
    if(typeof link!=='string')throw new HttpError(502,'Collegamento al file non disponibile.');
    const signedUrl=new URL(link.startsWith('/object/')?'/storage/v1'+link:link,url);
    // The API never returns redirects or arbitrary origins to the client.
    if(signedUrl.origin!==url)throw new HttpError(502,'Collegamento al file non valido.');
    return signedUrl.href;
  }
  return {url,call,table,rpc,download,signed};
}
