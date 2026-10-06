-- Invitation acceptance (spec §6.5). Invitations are created by the invite-user Edge Function
-- (service role), which stores only a SHA-256 hash of the token and sends the email through
-- Supabase Auth. The invitee signs in via that email, then calls accept_invitation(token).

create or replace function public.hash_invite_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

create or replace function public.accept_invitation(p_token text, p_full_name text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invitations
  where token_hash = public.hash_invite_token(p_token)
  for update;

  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = '22023';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;

  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'invitation is for a different email address' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'account already set up' using errcode = '22023';
  end if;

  insert into public.profiles (id, organization_id, role, full_name, email, mfa_required, is_active)
  values (
    auth.uid(),
    v_inv.organization_id,
    v_inv.role,
    coalesce(nullif(btrim(p_full_name), ''), v_inv.full_name, split_part(v_email, '@', 1)),
    v_email,
    v_inv.role in ('nurse', 'agency_admin'),
    true
  );

  if v_inv.patient_id is not null and v_inv.role in ('caregiver', 'patient') then
    insert into public.patient_links (organization_id, patient_id, profile_id, relationship)
    values (
      v_inv.organization_id,
      v_inv.patient_id,
      auth.uid(),
      case v_inv.role when 'patient' then 'self' else 'caregiver' end
    )
    on conflict (patient_id, profile_id) do nothing;
  end if;

  update public.invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.role;
end;
$$;

revoke all on function public.accept_invitation(text, text) from public, anon;
grant execute on function public.accept_invitation(text, text) to authenticated;
