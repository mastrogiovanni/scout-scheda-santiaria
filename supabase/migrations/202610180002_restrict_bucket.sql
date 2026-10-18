-- A restrictive policy also protects this bucket if another application adds
-- a broad permissive policy to the shared Storage table in the future.
create policy scout_packages_deny_direct_access on storage.objects
as restrictive for all to anon,authenticated
using (bucket_id <> 'scout-packages')
with check (bucket_id <> 'scout-packages');
