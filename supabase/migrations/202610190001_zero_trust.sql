begin;
-- Additive migration: legacy plaintext collections are never copied into this archive.
create table public.scout_secure_leaders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check(length(display_name) between 1 and 100),
  public_key jsonb not null,
  key_id text not null unique,
  created_at timestamptz not null default now()
);
create table public.scout_secure_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.scout_secure_leaders(user_id),
  name text not null check(length(name) between 1 and 80),
  scout_year text not null check(scout_year ~ '^20[0-9]{2}-20[0-9]{2}$' and right(scout_year,4)::int=left(scout_year,4)::int+1),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  closed boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.scout_secure_sheets (
  id uuid primary key,
  group_id uuid not null references public.scout_secure_groups(id) on delete cascade,
  envelope jsonb not null check(octet_length(envelope::text)<=360000),
  received_at timestamptz not null default now()
);
create index scout_secure_owner on public.scout_secure_groups(owner_id);
create index scout_secure_group on public.scout_secure_sheets(group_id,received_at,id);
alter table public.scout_secure_leaders enable row level security;
alter table public.scout_secure_groups enable row level security;
alter table public.scout_secure_sheets enable row level security;
revoke all on public.scout_secure_leaders,public.scout_secure_groups,public.scout_secure_sheets from public,anon,authenticated;
grant select on public.scout_secure_leaders,public.scout_secure_groups,public.scout_secure_sheets to authenticated;
create policy scout_secure_own_profile on public.scout_secure_leaders for select to authenticated using(user_id=(select auth.uid()));
create policy scout_secure_own_groups on public.scout_secure_groups for select to authenticated using(owner_id=(select auth.uid()));
create policy scout_secure_own_sheets on public.scout_secure_sheets for select to authenticated using(exists(select 1 from public.scout_secure_groups g where g.id=group_id and g.owner_id=(select auth.uid())));

create function public.scout_secure_profile() returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(l) from public.scout_secure_leaders l where l.user_id=auth.uid();
$$;
create function public.scout_secure_register(p_name text,p_public_key jsonb,p_key_id text) returns void language plpgsql security definer set search_path='' as $$
declare actual_id text;
begin
 if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 or p_public_key is null or p_key_id is null then raise exception 'Dati del capo non validi'; end if;
 if jsonb_typeof(p_public_key)<>'object' or (select count(*) from jsonb_object_keys(p_public_key))<>5
   or p_public_key->>'kty' is distinct from 'EC' or p_public_key->>'crv' is distinct from 'P-256'
   or p_public_key->>'ext' is distinct from 'true' or coalesce(p_public_key->>'x','') !~ '^[A-Za-z0-9_-]{43}$'
   or coalesce(p_public_key->>'y','') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Chiave pubblica non valida'; end if;
 actual_id=rtrim(translate(encode(sha256(convert_to(format('{"crv":"P-256","kty":"EC","x":"%s","y":"%s"}',p_public_key->>'x',p_public_key->>'y'),'UTF8')),'base64'),'+/','-_'),'=');
 if actual_id<>p_key_id then raise exception 'Impronta errata'; end if;
 insert into public.scout_secure_leaders(user_id,display_name,public_key,key_id) values(auth.uid(),trim(p_name),p_public_key,p_key_id);
end;$$;
create function public.scout_secure_groups() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(g)-'token_hash' order by g.created_at desc),'[]'::jsonb) from public.scout_secure_groups g where g.owner_id=auth.uid();
$$;
create function public.scout_secure_create_group(p_name text,p_year text,p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.scout_secure_groups;
begin
 if auth.uid() is null or not exists(select 1 from public.scout_secure_leaders where user_id=auth.uid()) then raise exception 'Censisci prima il capo'; end if;
 perform 1 from public.scout_secure_leaders where user_id=auth.uid() for update;
 if (select count(*) from public.scout_secure_groups where owner_id=auth.uid())>=100 then raise exception 'Massimo 100 gruppi per capo'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link non valido'; end if;
 insert into public.scout_secure_groups(owner_id,name,scout_year,token_hash) values(auth.uid(),trim(p_name),p_year,encode(sha256(convert_to(p_token,'UTF8')),'hex')) returning * into g;
 return to_jsonb(g)-'token_hash';
end;$$;
create function public.scout_secure_update_group(p_group_id uuid,p_closed boolean,p_token text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_closed is null then raise exception 'Accesso richiesto'; end if;
 if p_token is not null and p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link non valido'; end if;
 update public.scout_secure_groups set closed=p_closed,token_hash=case when p_token is null then token_hash else encode(sha256(convert_to(p_token,'UTF8')),'hex') end where id=p_group_id and owner_id=auth.uid();
 if not found then raise exception 'Gruppo non disponibile'; end if;
end;$$;
create function public.scout_secure_group_info(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link non valido'; end if;
 select jsonb_build_object('groupId',g.id,'name',g.name,'year',g.scout_year,'closed',g.closed,'leader',l.display_name,'publicKey',l.public_key,'keyId',l.key_id) into result
 from public.scout_secure_groups g join public.scout_secure_leaders l on l.user_id=g.owner_id where g.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if result is null then raise exception 'Link non disponibile o revocato'; end if;
 return result;
end;$$;
create function public.scout_secure_submit(p_token text,p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.scout_secure_groups; l public.scout_secure_leaders; s public.scout_secure_sheets; sheet_id uuid; e jsonb=p_envelope;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Link non valido'; end if;
 select * into g from public.scout_secure_groups where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found then raise exception 'Link non disponibile o revocato'; end if;
 select * into l from public.scout_secure_leaders where user_id=g.owner_id;
 if e is null or jsonb_typeof(e)<>'object' or octet_length(e::text)>360000 then raise exception 'Scheda cifrata non valida'; end if;
 if (select count(*) from jsonb_object_keys(e))<>9 or e->>'format' is distinct from 'scout-sealed' or e->'version' is distinct from '1'::jsonb
 or e->>'groupId' is distinct from g.id::text or e->>'keyId' is distinct from l.key_id
 or coalesce(e->>'submissionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or coalesce(e->>'salt','') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(e->>'iv','') !~ '^[A-Za-z0-9_-]{16}$'
 or length(coalesce(e->>'ciphertext','')) not between 22 and 350000 or e->>'ciphertext' !~ '^[A-Za-z0-9_-]+$'
 or jsonb_typeof(e->'ephemeral') is distinct from 'object' then raise exception 'Formato della scheda cifrata non valido'; end if;
 if (select count(*) from jsonb_object_keys(e->'ephemeral'))<>5 or e->'ephemeral'->>'kty' is distinct from 'EC' or e->'ephemeral'->>'crv' is distinct from 'P-256'
 or e->'ephemeral'->>'ext' is distinct from 'true' or coalesce(e->'ephemeral'->>'x','') !~ '^[A-Za-z0-9_-]{43}$'
 or coalesce(e->'ephemeral'->>'y','') !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Chiave effimera non valida'; end if;
 sheet_id=(e->>'submissionId')::uuid;
 select * into s from public.scout_secure_sheets where id=sheet_id;
 if found then
   if s.group_id<>g.id or s.envelope<>e then raise exception 'Ricevuta non corrispondente'; end if;
   return jsonb_build_object('receipt',s.id,'receivedAt',s.received_at);
 end if;
 if g.closed then raise exception 'Consegne chiuse'; end if;
 if (select count(*) from public.scout_secure_sheets where group_id=g.id)>=400 then raise exception 'Massimo 400 schede per gruppo'; end if;
 insert into public.scout_secure_sheets(id,group_id,envelope) values(sheet_id,g.id,e) returning * into s;
 return jsonb_build_object('receipt',s.id,'receivedAt',s.received_at);
end;$$;
-- Explicit pagination avoids PostgREST's row limit and keeps each response bounded.
create function public.scout_secure_sheets(p_group_id uuid,p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s) order by s.received_at,s.id),'[]'::jsonb) from
 (select * from public.scout_secure_sheets where group_id=p_group_id order by received_at,id limit 20 offset greatest(0,least(400,p_offset))) s;
$$;
revoke all on function public.scout_secure_profile(),public.scout_secure_register(text,jsonb,text),public.scout_secure_groups(),public.scout_secure_create_group(text,text,text),public.scout_secure_update_group(uuid,boolean,text),public.scout_secure_group_info(text),public.scout_secure_submit(text,jsonb),public.scout_secure_sheets(uuid,integer) from public,anon,authenticated;
grant execute on function public.scout_secure_profile(),public.scout_secure_register(text,jsonb,text),public.scout_secure_groups(),public.scout_secure_create_group(text,text,text),public.scout_secure_update_group(uuid,boolean,text),public.scout_secure_sheets(uuid,integer) to authenticated;
grant execute on function public.scout_secure_group_info(text),public.scout_secure_submit(text,jsonb) to anon,authenticated;
commit;
