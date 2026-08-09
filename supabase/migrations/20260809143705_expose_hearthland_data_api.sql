-- Keep the existing COM `public` API schema available and add Hearthland.
-- RLS and explicit grants in the foundation migration remain authoritative.
alter role authenticator set pgrst.db_schemas = 'public, hearthland';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
