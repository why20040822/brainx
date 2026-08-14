/** ttcsdk/user.js — 用户域 API（配额/当前身份）。 */
import { ttcRequest } from './http.js';

/** 我的库容配额（也是「凭据是否有效」的最轻探针）。 */
export const quota = (jwt, fetchImpl) => ttcRequest(jwt, 'GET', '/api/crm/v1/user/quota', undefined, fetchImpl);

/** 当前登录用户（连接身份回显用）。 */
export const currentUser = (jwt, fetchImpl) => ttcRequest(jwt, 'GET', '/api/user_service/v1/login/user', undefined, fetchImpl);
