-- public_profiles is an auto-updatable view created AFTER 001's blanket REVOKE, so on Supabase it inherited default
-- privileges (INSERT/UPDATE/DELETE/TRUNCATE/...) for anon and authenticated. Because the view runs with its owner's
-- rights, those would have allowed writes to profiles through the public API. Restore read-only access.
-- security_invoker is intentionally NOT enabled: profiles has no anon grant or RLS policy, so an invoker view would
-- stop returning the intended public columns (id, display_name, role, wallet_address, is_demo; never wallet_nonce).
REVOKE ALL ON public_profiles FROM anon, authenticated;
GRANT SELECT ON public_profiles TO anon, authenticated;
