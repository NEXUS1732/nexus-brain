# NEXUS username authentication staging setup

This branch is isolated from the production Worker. Do not deploy it with the production D1 binding.

## Required Cloudflare setup

1. In Cloudflare, open **Storage & databases → D1** and create a database named `nexus-memory-staging`.
2. Copy its database ID into `database_id` in `wrangler.staging.jsonc`, replacing the placeholder.
3. Open the new staging database's SQL console and run the contents of `database/username-auth.sql`.
4. Configure the staging Worker secrets/variables:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `EXA_API_KEY`
   Use the existing Supabase project values for the one-time legacy-account migration. Set the Exa key as a secret, not a plain variable.
5. Deploy only with `wrangler.staging.jsonc`. The staging Worker name is `nexus-brain-staging`.

The production Worker and production D1 database must remain untouched until staging tests pass and the Safe Browsing review is resolved.

## Account migration

The migration endpoint verifies the old Supabase session, then creates a NEXUS username/password account using the same user ID. This preserves ownership of existing conversations and memories. The new password is PBKDF2-SHA-256 hashed with a per-account random salt. Session tokens are random, stored only as SHA-256 hashes, and expire after 30 days.

The frontend stores the issued bearer token in browser local storage. This is a deliberate browser-session trade-off; protect the app against script injection before public launch.

## Current limitations

- Guest mode is not implemented yet.
- This configuration is not deployable until a separate staging D1 database ID is supplied.
- No production deployment or production database migration has been performed.
