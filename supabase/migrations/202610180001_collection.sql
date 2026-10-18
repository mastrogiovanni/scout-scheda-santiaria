begin;
create table public.scout_leaders (
  email text primary key check(email=lower(email) and length(email)<=254),
  role text not null default 'leader' check(role in ('admin','leader')),
  enabled boolean not null default true
);
create table public.scout_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  deadline timestamptz not null,
  delete_after timestamptz not null check(delete_after>deadline),
  closed boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.scout_invitations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.scout_collections(id) on delete cascade,
  label text not null check(length(label) between 1 and 160),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.scout_submissions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.scout_invitations(id) on delete cascade,
  collection_id uuid not null references public.scout_collections(id) on delete cascade,
  object_path text not null unique,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  size integer not null check(size between 1 and 12582912),
  status text not null default 'uploading' check(status in ('uploading','received','checked')),
  scout_name text,
  unit text,
  receipt uuid not null default gen_random_uuid(),
  received_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index scout_inv_collection on public.scout_invitations(collection_id);
create index scout_sub_collection on public.scout_submissions(collection_id);
create table public.scout_rate_limits (key text primary key, started_at timestamptz not null default now(), attempts integer not null default 1);

-- The browser never queries tables or lists objects directly. All authorization
-- is enforced in the API; the project secret remains in Netlify Functions.
alter table public.scout_leaders enable row level security;
alter table public.scout_collections enable row level security;
alter table public.scout_invitations enable row level security;
alter table public.scout_submissions enable row level security;
alter table public.scout_rate_limits enable row level security;
revoke all on public.scout_leaders,public.scout_collections,public.scout_invitations,public.scout_submissions,public.scout_rate_limits from anon,authenticated;
grant all on public.scout_leaders,public.scout_collections,public.scout_invitations,public.scout_submissions,public.scout_rate_limits to service_role;

create function public.scout_rate_check(p_key text,p_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare hits integer;
begin
  insert into public.scout_rate_limits as r(key) values(p_key)
  on conflict(key) do update set
    attempts=case when r.started_at<now()-interval '15 minutes' then 1 else r.attempts+1 end,
    started_at=case when r.started_at<now()-interval '15 minutes' then now() else r.started_at end
  returning attempts into hits;
  return hits<=p_limit;
end $$;

create function public.scout_create_invitation(p_collection uuid,p_label text,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare col public.scout_collections; inv public.scout_invitations;
begin
  select * into col from public.scout_collections where id=p_collection for update;
  if not found or col.closed or col.deadline<now() or col.delete_after<now() then raise exception 'closed_collection'; end if;
  if (select count(*) from public.scout_invitations where collection_id=col.id)>=400 then raise exception 'invitation_limit'; end if;
  insert into public.scout_invitations(collection_id,label,token_hash) values(col.id,p_label,p_hash) returning * into inv;
  return jsonb_build_object('id',inv.id);
end $$;

create function public.scout_begin_upload(p_token_hash text,p_sha256 text,p_size integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.scout_invitations; col public.scout_collections; sub public.scout_submissions;
begin
  select * into inv from public.scout_invitations where token_hash=p_token_hash for update;
  if not found or inv.revoked then raise exception 'invalid_invitation'; end if;
  select * into col from public.scout_collections where id=inv.collection_id for share;
  if col.closed or col.deadline<now() or col.delete_after<now() then raise exception 'closed_collection'; end if;
  select * into sub from public.scout_submissions where invitation_id=inv.id for update;
  if found and sub.status<>'uploading' then
    if sub.sha256<>p_sha256 then raise exception 'already_delivered'; end if;
    return to_jsonb(sub);
  end if;
  if sub.id is null then
    insert into public.scout_submissions(invitation_id,collection_id,object_path,sha256,size)
    values(inv.id,col.id,col.id::text||'/'||gen_random_uuid()::text||'.zip',p_sha256,p_size) returning * into sub;
  elsif sub.sha256<>p_sha256 or sub.size<>p_size then
    update public.scout_submissions set object_path=col.id::text||'/'||gen_random_uuid()::text||'.zip',sha256=p_sha256,size=p_size where id=sub.id returning * into sub;
  end if;
  return to_jsonb(sub);
end $$;

create function public.scout_complete_upload(p_token_hash text,p_id uuid,p_sha256 text,p_name text,p_unit text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.scout_invitations; col public.scout_collections; sub public.scout_submissions;
begin
  select * into inv from public.scout_invitations where token_hash=p_token_hash for update;
  if not found or inv.revoked then raise exception 'invalid_invitation'; end if;
  select * into col from public.scout_collections where id=inv.collection_id for share;
  if col.closed or col.deadline<now() or col.delete_after<now() then raise exception 'closed_collection'; end if;
  select * into sub from public.scout_submissions where id=p_id and invitation_id=inv.id for update;
  if not found or sub.sha256<>p_sha256 then raise exception 'upload_changed'; end if;
  if sub.status='uploading' then
    update public.scout_submissions set status='received',scout_name=p_name,unit=p_unit,received_at=now() where id=sub.id returning * into sub;
  end if;
  return jsonb_build_object('receipt',sub.receipt,'receivedAt',sub.received_at,'collection',col.name);
end $$;
revoke all on function public.scout_rate_check(text,integer),public.scout_create_invitation(uuid,text,text),public.scout_begin_upload(text,text,integer),public.scout_complete_upload(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.scout_rate_check(text,integer),public.scout_create_invitation(uuid,text,text),public.scout_begin_upload(text,text,integer),public.scout_complete_upload(text,uuid,text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scout-packages','scout-packages',false,12582912,array['application/zip']);
-- No storage policies grant access to anon/authenticated. Signed URLs permit
-- exactly one object operation, never bucket listing or access to other files.
commit;
