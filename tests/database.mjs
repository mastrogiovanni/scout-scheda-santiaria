// Isolated PostgreSQL cluster, Unix socket only. Never connects to a configured Supabase project.
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateIdentity,seal} from '../src/crypto.js';
const folder=await mkdtemp(join(tmpdir(),'scout-pg-')),db=join(folder,'data');
function run(binary,args){const result=spawnSync(binary,args,{encoding:'utf8'});if(result.status!==0)throw Error(binary+' failed:\n'+result.stderr+'\n'+result.stdout);return result.stdout;}
const identity=await generateIdentity(),b=await generateIdentity(),uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',token='a'.repeat(64),groupId='33333333-3333-4333-8333-333333333333';
const envelope=await seal({only:'synthetic test data'},{groupId,keyId:identity.keyId,publicKey:identity.publicKey});
const secondEnvelope=await seal({only:'synthetic test data'},{groupId,keyId:identity.keyId,publicKey:identity.publicKey});
const lit=value=>"'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
const migration=await readFile(new URL('../supabase/migrations/202610190001_zero_trust.sql',import.meta.url),'utf8');
const sql=`
create role anon;create role authenticated;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
${migration}
create function public.test_assert(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg;end if;end$$;
insert into auth.users values('${uid}'),('${other}');
set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);
select public.scout_secure_register('Capo A',${lit(identity.publicKey)},'${identity.keyId}');
select public.test_assert(public.scout_secure_profile()->>'key_id'='${identity.keyId}','Profile');
select public.scout_secure_create_group('Esploratori','2026-2027','${token}');
reset role;
update public.scout_secure_groups set id='${groupId}';
set role authenticated;select set_config('request.jwt.claim.sub','${other}',false);
select public.scout_secure_register('Capo B',${lit(b.publicKey)},'${b.keyId}');
select public.test_assert((select count(*) from public.scout_secure_groups)=0,'RLS groups isolation');
select public.test_assert(public.scout_secure_groups()='[]'::jsonb,'RPC isolation');
do $$begin perform public.scout_secure_update_group('${groupId}',true);raise exception 'Unauthorized update passed';exception when raise_exception then if sqlerrm='Unauthorized update passed' then raise;end if;end$$;
set role anon;select set_config('request.jwt.claim.sub','',false);
select public.test_assert(public.scout_secure_group_info('${token}')->>'keyId'='${identity.keyId}','Link metadata');
select public.scout_secure_submit('${token}',${lit(envelope)});
select public.scout_secure_submit('${token}',${lit(envelope)});
do $$begin perform 1 from public.scout_secure_sheets;raise exception 'Anonymous read passed';exception when insufficient_privilege then null;end$$;
do $$begin perform public.scout_secure_submit('${token}',${lit({...envelope,name:'plaintext forbidden'})});raise exception 'Extra plaintext passed';exception when raise_exception then if sqlerrm='Extra plaintext passed' then raise;end if;end$$;
set role authenticated;select set_config('request.jwt.claim.sub','${other}',false);
select public.test_assert((select count(*) from public.scout_secure_sheets)=0,'RLS sheets isolation');
select public.test_assert(public.scout_secure_sheets('${groupId}')='[]'::jsonb,'Sheets RPC isolation');
select set_config('request.jwt.claim.sub','${uid}',false);
select public.test_assert(jsonb_array_length(public.scout_secure_sheets('${groupId}'))=1,'Idempotent submission');
select public.scout_secure_submit('${token}',${lit(secondEnvelope)});
select public.scout_secure_submit('${token}',${lit(secondEnvelope)});
select public.test_assert(jsonb_array_length(public.scout_secure_sheets('${groupId}'))=2,'Same group link accepts a new submission and its retry');
select public.test_assert((select envelope from public.scout_secure_sheets where id='${envelope.submissionId}')=${lit(envelope)},'Original submission preserved');
select public.scout_secure_update_group('${groupId}',true);
set role anon;select set_config('request.jwt.claim.sub','',false);
do $$begin perform public.scout_secure_submit('${token}',${lit({...envelope,submissionId:crypto.randomUUID()})});raise exception 'Closed group accepted a new sheet';exception when raise_exception then if sqlerrm='Closed group accepted a new sheet' then raise;end if;end$$;
set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);
select public.scout_secure_update_group('${groupId}',false,'${'b'.repeat(64)}');
set role anon;select set_config('request.jwt.claim.sub','',false);
do $$begin perform public.scout_secure_group_info('${token}');raise exception 'Old link accepted';exception when raise_exception then if sqlerrm='Old link accepted' then raise;end if;end$$;
reset role;
select public.test_assert((select count(*) from public.scout_secure_sheets)=2,'Count');
with ids as(select gen_random_uuid() id from generate_series(1,25)) insert into public.scout_secure_sheets(id,group_id,envelope) select id,'${groupId}',jsonb_set(${lit(envelope)},'{submissionId}',to_jsonb(id)) from ids;
set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);
select public.test_assert(jsonb_array_length(public.scout_secure_sheets('${groupId}',0))=20,'First page');
select public.test_assert(jsonb_array_length(public.scout_secure_sheets('${groupId}',20))=7,'Second page');
reset role;
select public.test_assert(not has_function_privilege('anon','public.scout_secure_register(text,jsonb,text)','execute'),'Anon cannot register');
select public.test_assert(not has_table_privilege('authenticated','public.scout_secure_leaders','update'),'Cannot replace public key');
select public.test_assert(not has_table_privilege('anon','public.scout_secure_sheets','select'),'Anonymous table privileges');
`;
let started=false;
try{run('initdb',['-D',db,'-A','trust','--no-locale','-E','UTF8']);run('pg_ctl',['-D',db,'-l',join(folder,'postgres.log'),'-o',`-h '' -k ${folder} -p 55437`,'-w','start']);started=true;await writeFile(join(folder,'test.sql'),sql);run('psql',['-h',folder,'-p','55437','-d','postgres','-v','ON_ERROR_STOP=1','-f',join(folder,'test.sql')]);console.log('Migrazione PostgreSQL, RLS tra due capi, privilegi anon, JSON cifrato e idempotenza verificati.');}
finally{if(started)run('pg_ctl',['-D',db,'-m','fast','-w','stop']);}
