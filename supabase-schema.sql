CREATE TABLE IF NOT EXISTS exam_config (
    id text PRIMARY KEY,
    settings jsonb NOT NULL,
    questions jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_sessions (
    session_id text PRIMARY KEY,
    nis text,
    exam_id text,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exam_sessions_nis_idx ON exam_sessions (nis);
CREATE INDEX IF NOT EXISTS exam_sessions_exam_id_idx ON exam_sessions (exam_id);
CREATE INDEX IF NOT EXISTS exam_sessions_updated_at_idx ON exam_sessions (updated_at);
