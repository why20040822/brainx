-- 0009_switch_app.sql — 飞书身份整体切换到「braintex的小机器人」（cli_aaf72a911bb9dd21）
--
-- 背景（2026-08-14 Mia 拍板：全部换成 braintex 的小机器人）：
-- open_id 按应用隔离——花名册里存的旧 open_id 是 Mia 个人应用名下的，对新应用无效
-- （推卡报 99992361 open_id cross app 实证）。本迁移把六人映射到新应用名下 open_id
-- （contact API 实拉，见 VERIFICATION §17）。
-- 旧应用签发的用户令牌对新应用无意义（refresh 走新应用凭据必败），清空强制各自重登
-- ——重登后按人桥接即以新应用身份恢复。
UPDATE consultants SET open_id='ou_3b30bc83806e157d9af0cd9188d7ab8d' WHERE consultant_id='felix';
UPDATE consultants SET open_id='ou_2523c1e4f0844de00db90f810e970507' WHERE consultant_id='mia';
UPDATE consultants SET open_id='ou_fe61bf6ab2dc68b16fc58790fb45d44b' WHERE consultant_id='york';
UPDATE consultants SET open_id='ou_6f357ee5cf73c7f2bb9c589d866cadea' WHERE consultant_id='wendy';
UPDATE consultants SET open_id='ou_4c810c0729050de5877347697aee2c29' WHERE consultant_id='linda';
UPDATE consultants SET open_id='ou_7936bee222cd063e58b5f789dfb0f066' WHERE consultant_id='shanon';
DELETE FROM consultant_tokens;
