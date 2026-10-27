CREATE TABLE host.request_budgets (
    namespace text NOT NULL,
    key text NOT NULL,
    count integer NOT NULL CHECK (count > 0),
    reset_at timestamptz NOT NULL,
    PRIMARY KEY (namespace, key)
);
CREATE INDEX request_budgets_expiry ON host.request_budgets(reset_at);
