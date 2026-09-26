    alter table public.app_members
      drop constraint if exists app_members_role_chk;

    alter table public.app_members
      add constraint app_members_role_chk
      check (role in ('owner','admin','member'));

    create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $$
      select exists (
        select 1
        from public.app_members
        where user_id = auth.uid()
          and approved = true
          and role in ('owner','admin')
      );
    $$;

    create or replace function public.approve_member(p_user_id uuid, p_approved boolean default true)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      target_role text;
      actor_is_owner boolean := public.is_owner();
      actor_is_admin boolean := public.is_admin();
    begin
      if not actor_is_admin then
        raise exception 'admin only';
      end if;

      select role into target_role
      from public.app_members
      where user_id = p_user_id;

      if target_role is null then
        raise exception 'member not found';
      end if;

      if target_role = 'owner' then
        raise exception 'owner cannot be changed';
      end if;

      if not actor_is_owner and target_role <> 'member' then
        raise exception 'admin can manage members only';
      end if;

      if p_user_id = auth.uid() and p_approved = false then
        raise exception 'cannot revoke self';
      end if;

      update public.app_members
      set approved = p_approved,
          approved_at = case when p_approved then now() else null end
      where user_id = p_user_id;
    end;
    $$;

    create or replace function public.decline_member(p_user_id uuid, p_mode text)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      target_email text;
      target_role text;
      target_approved boolean;
      actor_is_owner boolean := public.is_owner();
      actor_is_admin boolean := public.is_admin();
    begin
      if not actor_is_admin then
        raise exception 'admin only';
      end if;

      select lower(email), role, approved
      into target_email, target_role, target_approved
      from public.app_members
      where user_id = p_user_id;

      if target_email is null then
        raise exception 'member not found';
      end if;

      if target_role = 'owner' then
        raise exception 'owner cannot be declined';
      end if;

      if not actor_is_owner and target_role <> 'member' then
        raise exception 'admin can manage members only';
      end if;

      if target_approved then
        raise exception 'approved member must be revoked, not declined';
      end if;

      if p_mode = 'block_5m' then
        insert into public.access_blocks(email, blocked_until, created_by, created_at)
        values (target_email, now() + interval '5 minutes', auth.uid(), now())
        on conflict (email) do update
          set blocked_until = excluded.blocked_until,
              created_by = excluded.created_by,
              created_at = now();
      elsif p_mode = 'remove' then
        delete from public.access_blocks where email = target_email;
      else
        raise exception 'invalid decline mode';
      end if;

      delete from auth.users where id = p_user_id;
    end;
    $$;

    create or replace function public.set_member_role(p_user_id uuid, p_role text)
    returns void
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      target_role text;
      normalized_role text := lower(btrim(coalesce(p_role,'')));
    begin
      if not public.is_owner() then
        raise exception 'owner only';
      end if;

      if normalized_role not in ('admin','member') then
        raise exception 'invalid role';
      end if;

      select role into target_role
      from public.app_members
      where user_id = p_user_id;

      if target_role is null then
        raise exception 'member not found';
      end if;

      if target_role = 'owner' then
        raise exception 'owner role cannot be changed';
      end if;

      update public.app_members
      set role = normalized_role
      where user_id = p_user_id;
    end;
    $$;

    drop policy if exists "members read" on public.app_members;
    create policy "members read"
    on public.app_members
    for select
    to authenticated
    using ((user_id = auth.uid()) or public.is_admin());

    drop policy if exists "owner updates members" on public.app_members;

    revoke execute on function public.is_admin() from public, anon;
    grant execute on function public.is_admin() to authenticated;

    revoke execute on function public.approve_member(uuid,boolean) from public, anon;
    grant execute on function public.approve_member(uuid,boolean) to authenticated;

    revoke execute on function public.decline_member(uuid,text) from public, anon;
    grant execute on function public.decline_member(uuid,text) to authenticated;

    revoke execute on function public.set_member_role(uuid,text) from public, anon;
    grant execute on function public.set_member_role(uuid,text) to authenticated;
  