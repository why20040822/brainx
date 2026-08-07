-- 0003_consultants.sql — 顾问花名册（OAuth 登录的身份权威）
-- 种子来源：FLX 职位优先级群(oc_667758eb50ad4b1af86ae99d79859870)成员列表，2026-08-07 实拉
CREATE TABLE IF NOT EXISTS consultants (
  consultant_id TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  open_id       TEXT UNIQUE,          -- 飞书 open_id，OAuth 回调按此匹配身份
  profile_json  TEXT NOT NULL DEFAULT '{}',  -- 方向画像关键词等（原 consultants.json 内容）
  source        TEXT NOT NULL DEFAULT 'flx_group',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consultants_open_id ON consultants(open_id);
