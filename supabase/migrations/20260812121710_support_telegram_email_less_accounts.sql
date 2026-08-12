-- Telegram OIDC identities may not expose an email claim. Keep account email
-- nullable and reserve case-insensitive uniqueness for real email addresses.
alter table hearthland.accounts
  alter column email drop not null;

drop index if exists hearthland.accounts_email_lower_unique;

create unique index accounts_email_lower_unique
  on hearthland.accounts (lower(email))
  where email is not null;

-- Remove only placeholders produced by the original auth trigger. The UUID in
-- the local part must exactly match the account row so unrelated pending.local
-- addresses remain intact.
update hearthland.accounts
set email = null,
    updated_at = now()
where email = id::text || '@pending.local';

create or replace function hearthland_private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  profile_entity_id uuid;
  chosen_name text;
  real_email text;
begin
  real_email := nullif(btrim(new.email), '');
  if real_email = new.id::text || '@pending.local' then
    real_email := null;
  end if;

  chosen_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(
      btrim(
        concat_ws(
          ' ',
          nullif(btrim(new.raw_user_meta_data ->> 'given_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'family_name'), '')
        )
      ),
      ''
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'preferred_username'), ''),
    case
      when real_email is not null and position('@' in real_email) > 1
        then nullif(btrim(split_part(real_email, '@', 1)), '')
      else null
    end,
    'Hearthland member'
  );

  insert into hearthland.accounts (id, email, display_name)
  values (new.id, real_email, chosen_name)
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when hearthland.accounts.display_name = '' then excluded.display_name
          else hearthland.accounts.display_name
        end,
        updated_at = now();

  select p.entity_id into profile_entity_id
  from hearthland.person_profiles p
  where p.account_id = new.id;

  if profile_entity_id is null then
    profile_entity_id := gen_random_uuid();
    insert into hearthland.entities (
      id, entity_type, slug, title, publication_status, visibility,
      owner_account_id, created_by_account_id
    ) values (
      profile_entity_id,
      'person_profile',
      'person-' || replace(new.id::text, '-', ''),
      chosen_name,
      'draft',
      'members',
      new.id,
      new.id
    );

    insert into hearthland.person_profiles (entity_id, account_id, display_name)
    values (profile_entity_id, new.id, chosen_name);
  end if;

  insert into hearthland.notification_preferences (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  return new;
end;
$$;

revoke all on function hearthland_private.handle_auth_user() from public;
