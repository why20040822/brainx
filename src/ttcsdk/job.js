/** ttcsdk/job.js — 职位域 API（ATS 真 project_id / HC / Pipeline 的源头）。 */
import { ttcRequest } from './http.js';

/** 职位检索（POST search）。返回该 JWT 持有者权限视图内的职位。 */
export const search = (jwt, query = {}, fetchImpl) =>
  ttcRequest(jwt, 'POST', '/api/crm/v1/job/search',
    { page: 1, page_size: 50, ...query }, fetchImpl);
