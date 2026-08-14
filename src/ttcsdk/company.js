/** ttcsdk/company.js — 公司（客户）域 API。 */
import { ttcRequest } from './http.js';

/** 公司检索（POST search）。query 形态见 TTC SPA；默认拉第一页。 */
export const search = (jwt, query = {}, fetchImpl) =>
  ttcRequest(jwt, 'POST', '/api/crm/v1/company/search',
    { page: 1, page_size: 50, ...query }, fetchImpl);
