/** types.js — PRD §8 类型的 JSDoc 镜像（运行时不强制，开发与校验对照用）。
 * @typedef {'RECOMMEND_WATCH'|'RECOMMEND_ACCEPT'|'OBSERVE'|'EXCLUDE'} RecommendationAction
 * @typedef {'WATCH'|'ACCEPT'|'DISMISS'|'RELEASE'|'COMPLETE'} EngagementCommand
 * @typedef {'NEW'|'RECOMMENDED'|'VIEWED'|'WATCHED'|'ACCEPTED'|'DISMISSED'|'RELEASED'|'EXPIRED'|'COMPLETED'} EngagementState
 * @typedef {'MY_JOB'|'PRIMARY_PM'|'TEAM_SHARED'|'OTHER_CONSULTANT'|'NOT_JOINED'|'UNKNOWN'} Relation
 * @typedef {Object} Recommendation
 * @property {string} decision_id
 * @property {number} rank
 * @property {RecommendationAction} action
 * @property {number} score
 * @property {'LOW'|'MEDIUM'|'HIGH'} confidence_band
 * @property {number} evidence_coverage
 * @property {string[]} reasons
 * @property {string[]} risks
 * @property {{dim:string, weight:number, score:number|null}[]} breakdown
 * @property {{project_id:string, company:string, role:string, city?:string, pipeline?:string,
 *   hc?:number|null, active_state:string, relation:Relation, source_url?:string}} job
 * @typedef {Object} SyncStatus
 * @property {'READY'|'RUNNING'|'INCOMPLETE'|'AUTH_EXPIRED'|'ERROR'|'EMPTY'} state
 * @property {string|null} updated_at
 * @property {number=} rows_read
 * @property {number=} rows_expected
 * @property {string[]=} errors
 */
export const REL_LABEL = {
  MY_JOB: '我的职位', PRIMARY_PM: '我主PM', TEAM_SHARED: '团队共享',
  OTHER_CONSULTANT: '他人主做', NOT_JOINED: '未加入', UNKNOWN: '未知',
};
export const ACTION_LABEL = { RECOMMEND_ACCEPT: '建议接单', RECOMMEND_WATCH: '建议关注', OBSERVE: '观察', EXCLUDE: '排除' };
export const BAND_LABEL = { HIGH: '置信高', MEDIUM: '置信中', LOW: '置信低' };
export const DIM_LABEL = { direction: 'Fit', activity: 'Activity', similarity: '历史相似',
  capacity: '承接容量', outcomes: '历史结果', exploration: '探索' };
export const STATE_LABEL = { NEW: '新', RECOMMENDED: '已推荐', VIEWED: '已查看', WATCHED: '关注中',
  ACCEPTED: '已接单', DISMISSED: '暂不考虑', RELEASED: '已释放', EXPIRED: '已过期', COMPLETED: '已完成' };
