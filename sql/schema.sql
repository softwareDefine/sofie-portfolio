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

-- v2: 프로젝트 상세페이지 (마크다운 본문 + 갤러리)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';

-- v3: 대표 프로젝트 (추가 시점 기존 행은 true, 이후 기본값 false)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE projects ALTER COLUMN featured SET DEFAULT false;

-- v4: 분야/목적/수상 필터
ALTER TABLE projects ADD COLUMN IF NOT EXISTS field   TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS award   TEXT NOT NULL DEFAULT '';

-- v5: 경력 상세 (마크다운 본문 + 갤러리)
ALTER TABLE careers ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
ALTER TABLE careers ADD COLUMN IF NOT EXISTS images  TEXT[] NOT NULL DEFAULT '{}';
