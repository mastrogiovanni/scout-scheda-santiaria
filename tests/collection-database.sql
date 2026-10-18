-- Run in the project's SQL Editor after the migration. All test records are
-- synthetic and rolled back; no emails are sent or Storage objects created.
begin;
do $$
declare uid uuid:=gen_random_uuid(); cid uuid; iid uuid; first_upload jsonb; retry jsonb; result jsonb; again jsonb; n integer;
begin
  if has_table_privilege('anon','public.scout_submissions','SELECT') or has_table_privilege('authenticated','public.scout_submissions','SELECT') then raise exception 'FAIL: direct table access'; end if;
  if has_function_privilege('anon','public.scout_begin_upload(text,text,integer)','EXECUTE') or has_function_privilege('authenticated','public.scout_complete_upload(text,uuid,text,text,text)','EXECUTE') then raise exception 'FAIL: direct RPC access'; end if;
  if exists(select 1 from pg_class join pg_namespace ns on ns.oid=relnamespace where ns.nspname='public' and relname like 'scout_%' and relkind='r' and not relrowsecurity) then raise exception 'FAIL: missing RLS'; end if;
  if not exists(select 1 from storage.buckets where id='scout-packages' and not public and file_size_limit=12582912) then raise exception 'FAIL: private bucket'; end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='scout_packages_deny_direct_access' and permissive='RESTRICTIVE') then raise exception 'FAIL: missing restrictive Storage policy'; end if;
  insert into auth.users(id,email,role,aud) values(uid,'synthetic-test@example.invalid','authenticated','authenticated');
  insert into public.scout_collections(name,deadline,delete_after,created_by) values('Synthetic transaction test',now()+interval '1 day',now()+interval '2 days',uid) returning id into cid;
  iid:=(public.scout_create_invitation(cid,'Synthetic family',repeat('a',64))->>'id')::uuid;
  first_upload:=public.scout_begin_upload(repeat('a',64),repeat('b',64),120);
  retry:=public.scout_begin_upload(repeat('a',64),repeat('b',64),120);
  if first_upload->>'id'<>retry->>'id' or first_upload->>'object_path'<>retry->>'object_path' then raise exception 'FAIL: upload retry'; end if;
  result:=public.scout_complete_upload(repeat('a',64),(first_upload->>'id')::uuid,repeat('b',64),'Synthetic Scout','Test unit');
  again:=public.scout_complete_upload(repeat('a',64),(first_upload->>'id')::uuid,repeat('b',64),'Synthetic Scout','Test unit');
  if result<>again or result->>'receipt' is null or result->>'receivedAt' is null then raise exception 'FAIL: receipt retry'; end if;
  begin
    perform public.scout_begin_upload(repeat('a',64),repeat('c',64),120);
    raise exception 'FAIL: replacement accepted';
  exception when others then if sqlerrm<>'already_delivered' then raise; end if; end;
  update public.scout_invitations set revoked=true where id=iid;
  begin
    perform public.scout_begin_upload(repeat('a',64),repeat('b',64),120);
    raise exception 'FAIL: revoked invitation accepted';
  exception when others then if sqlerrm<>'invalid_invitation' then raise; end if; end;
  update public.scout_invitations set revoked=false where id=iid;
  update public.scout_collections set closed=true where id=cid;
  begin
    perform public.scout_begin_upload(repeat('a',64),repeat('b',64),120);
    raise exception 'FAIL: closed collection accepted';
  exception when others then if sqlerrm<>'closed_collection' then raise; end if; end;
  update public.scout_collections set closed=false where id=cid;
  for n in 2..400 loop perform public.scout_create_invitation(cid,'Synthetic family',lpad(to_hex(n),64,'0')); end loop;
  begin
    perform public.scout_create_invitation(cid,'Overflow',repeat('f',64));
    raise exception 'FAIL: invitation limit';
  exception when others then if sqlerrm<>'invitation_limit' then raise; end if; end;
  if not public.scout_rate_check('synthetic-transaction-test',1) or public.scout_rate_check('synthetic-transaction-test',1) then raise exception 'FAIL: rate limit'; end if;
end $$;
rollback;
select 'PASS: private tables/bucket, RLS, RPC privileges, upload/receipt retries, no replacement, revoked/closed invitations, capacity and rate limiting; all test records rolled back.' as result;
