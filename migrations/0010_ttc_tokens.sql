-- 0010_ttc_tokens.sql — TTC 客户管理系统（app.ttcadvisory.com）按人凭据托管（2026-08-14）
-- 轻无感路径：用户每 ~60 天粘贴一次自己的 ottin JWT（v2），桥接按人以其自身权限视图读取。
-- 安全纪律与 consultant_tokens 相同：AES-256-GCM、密钥 data/.secret、不出网、不落日志。
CREATE TABLE IF NOT EXISTS ttc_tokens (
  consultant_id TEXT PRIMARY KEY,          -- 一人一行；只有本人能写（server 层强制）
  jwt_enc TEXT NOT NULL,                   -- AES-GCM 密文（feishu.js 同款 enc/dec）
  ttc_user_name TEXT,                      -- 连接身份回显（"已连接为：Wendy 郭雯"，防粘错号）
  person_id TEXT,                          -- TTC 系统 personId（X001496230 形态）
  expires_at TEXT NOT NULL,                -- JWT exp（v2 ≈ 60 天）
  needs_reauth INTEGER NOT NULL DEFAULT 0, -- 过期/验证失败置 1 → 前端胶囊提示重连
  updated_at TEXT NOT NULL
);
