-- 0005_per_user.sql — 按顾问飞书令牌（加密存储）+ 群成员缓存 + 消息可见性
--
-- 背景：改造前桥接用服务器上唯一一份 lark-cli 用户凭据（Mia 身份）拉取全部
-- 数据，三人工作台看到的都是 Mia 视野。本迁移起：
--   1. 每个顾问网页登录时存下自己的 user_access_token/refresh_token（AES-256-GCM
--      加密，密钥派生自 data/.secret，不落 git、不进归档）；
--   2. 群消息按各人自己的令牌与群成员身份拉取，可见性归属到顾问；
--   3. job_facts 保持全团队单表（外键/回放不破），可见性在 API 层按关系过滤。

CREATE TABLE IF NOT EXISTS consultant_tokens (
  consultant_id      TEXT PRIMARY KEY,
  open_id            TEXT NOT NULL,
  access_token_enc   TEXT NOT NULL,     -- v1.<iv>.<tag>.<ct>（hex，AES-256-GCM）
  refresh_token_enc  TEXT NOT NULL,
  access_expires_at  TEXT NOT NULL,     -- ISO；提前 5 分钟视为到期
  refresh_expires_at TEXT NOT NULL,     -- ISO；过了只能重新登录
  scope              TEXT NOT NULL DEFAULT '',
  needs_reauth       INTEGER NOT NULL DEFAULT 0,  -- refresh 被拒=1，桥接跳过该顾问
  updated_at         TEXT NOT NULL
);

-- 每人实际所在群（im/v1/chats 每轮刷新），桥接只读 BRIDGE_CHATS ∩ 此表
CREATE TABLE IF NOT EXISTS consultant_chats (
  consultant_id TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  name          TEXT,
  seen_at       TEXT NOT NULL,
  PRIMARY KEY (consultant_id, chat_id)
);

-- 消息可见性：job_messages 行全局去重（主键 message_id），谁能看由本表决定。
-- 同一职位市场群消息，felix 在群=可见，york 不在群=永不可见。
CREATE TABLE IF NOT EXISTS job_message_visibility (
  message_id    TEXT NOT NULL REFERENCES job_messages(message_id),
  consultant_id TEXT NOT NULL,
  ingested_at   TEXT NOT NULL,
  PRIMARY KEY (message_id, consultant_id)
);
CREATE INDEX IF NOT EXISTS idx_jmv_consultant ON job_message_visibility(consultant_id);

-- 存量数据归属：0005 之前所有消息都是 Mia 的 lark-cli 身份读入的 → 归属 mia。
INSERT OR IGNORE INTO job_message_visibility (message_id, consultant_id, ingested_at)
  SELECT message_id, 'mia', ingested_at FROM job_messages;

-- 游标连续性：全局游标（'chat:oc_x'）同样是 Mia 身份推进的 → 复制为她的个人
-- 游标（'chat:oc_x@mia'），避免改造后重复回看历史消息。felix/york 首次冷启动
-- 走 desc 最新一页（与既有行为一致）。
INSERT OR IGNORE INTO bridge_cursor (source, checkpoint, updated_at)
  SELECT source || '@mia', checkpoint, updated_at FROM bridge_cursor
  WHERE source LIKE 'chat:%' AND source NOT LIKE '%@%';
