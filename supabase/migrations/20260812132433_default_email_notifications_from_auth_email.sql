-- Auth providers such as Telegram may create users without an email claim.
-- Keep email delivery disabled for those accounts while preserving the
-- existing enabled-by-default behavior for accounts with a real email.
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

  insert into hearthland.notification_preferences (account_id, email_enabled)
  values (new.id, real_email is not null)
  on conflict (account_id) do nothing;

  return new;
end;
$$;

revoke all on function hearthland_private.handle_auth_user() from public;

-- Correct any preference row created after email-less Auth support landed but
-- before this trigger update. Accounts with a real email are left untouched.
update hearthland.notification_preferences as preferences
set email_enabled = false,
    updated_at = now()
from hearthland.accounts as account
where account.id = preferences.account_id
  and account.email is null
  and preferences.email_enabled;
