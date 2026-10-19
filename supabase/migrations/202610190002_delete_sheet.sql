begin;
-- Only the authenticated owner may remove a delivery. Repeated requests are harmless.
create or replace function public.scout_secure_delete_sheet(p_group_id uuid,p_sheet_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- Same group lock used by submission: serialize writes without exposing other groups.
  perform 1 from public.scout_secure_groups
    where id=p_group_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Gruppo non disponibile'; end if;
  delete from public.scout_secure_sheets where id=p_sheet_id and group_id=p_group_id;
end;$$;
revoke all on function public.scout_secure_delete_sheet(uuid,uuid) from public,anon,authenticated;
grant execute on function public.scout_secure_delete_sheet(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
