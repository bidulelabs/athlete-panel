-- Runtime may upgrade one legacy hash after application-side verification, but
-- cannot directly edit the owner table or replace an already-versioned hash.
CREATE FUNCTION host.upgrade_password_hash(expected_hash text, replacement_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE changed integer;
BEGIN
    IF expected_hash IS NULL OR replacement_hash IS NULL
       OR length(expected_hash) <> 161 OR length(replacement_hash) <> 180
       OR expected_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$'
       OR replacement_hash !~ '^scrypt[$]1[$]65536[$]8[$]2[$][a-f0-9]{32}[$][a-f0-9]{128}$' THEN
        RETURN false;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(736147001);
    UPDATE host.owner SET password_hash = replacement_hash
      WHERE id = 'owner' AND password_hash = expected_hash;
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed = 1;
END;
$$;
REVOKE ALL ON FUNCTION host.upgrade_password_hash(text, text) FROM PUBLIC;
