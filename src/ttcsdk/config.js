/** ttcsdk/config.js — 配置管理（SDK 模式：集中读取 env，缺配置显式报错，不静默失败）。 */
export const TTC_API_BASE = process.env.BRAINX_TTC_API_BASE || 'https://api.ttcadvisory.com';

/** JWT 临期阈值：剩余有效期不足 7 天 → 前端胶囊提示「重新连接」。 */
export const REAUTH_SOON_MS = 7 * 24 * 3600 * 1000;
