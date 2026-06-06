-- sofie-portfolio schema
CREATE TABLE IF NOT EXISTS careers (
    id          SERIAL PRIMARY KEY,
    year        INT     NOT NULL,
    title       TEXT    NOT NULL,
    featured    BOOLEAN NOT NULL DEFAULT false,
    sort_order  INT     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
    id          SERIAL PRIMARY KEY,
    year        INT     NOT NULL,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    tags        TEXT[]  NOT NULL DEFAULT '{}',
    image_url   TEXT,
    link_url    TEXT,
    sort_order  INT     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
