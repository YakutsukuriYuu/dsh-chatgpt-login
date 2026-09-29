/**
 * ChatGPT (Codex) 官方用量查询 — Host 半边专用。
 *
 * 只做一件事：拿凭据库里那条 `llm-pi-ai/openai-codex` 的 OAuth 凭据，去问官方
 * 用量接口还剩多少额度。接口是 Codex 客户端自己用的那个，不是公开文档 API：
 *
 *   GET https://chatgpt.com/backend-api/wham/usage
 *   Authorization: Bearer <access_token>
 *   ChatGPT-Account-Id: <account_id>
 *
 * 返回里的 `rate_limit.primary_window` 是 5 小时滚动窗口，`secondary_window`
 * 是 7 天窗口，两者都按“已用百分比”给出。access_token 是短命 JWT，401/403 时
 * 用 refresh_token 换一次新的再重试。
 *
 * 这里不读也不写凭据库：凭据对象由调用方传入，刷新结果作为新对象返回，
 * 由调用方决定要不要通过 `credentials.modifyRecord` 原子落盘。
 *
 * @module dsh-chatgpt-login/quota
 */

/** Codex 用量接口。 */
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
/** OAuth 令牌端点，与 pi-ai 的 Codex 认证流程同一个。 */
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** pi-ai 使用的 Codex OAuth client id。 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** JWT 里存放 ChatGPT 账号信息的 claim 路径。 */
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
/** 单次查询的超时，避免界面卡在一个不响应的端点上。 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 把一个用量窗口读成纯数据。
 * @param value - `primary_window` / `secondary_window`。
 * @param label - 出错信息里用的中文标签。
 * @returns 已用百分比、重置时间戳（毫秒）与窗口长度。
 */
function readWindow(value, label) {
	if (value === null || typeof value !== 'object') throw new Error(`用量接口没有返回${label}窗口。`);
	const used = Number(value.used_percent);
	const resetAt = Number(value.reset_at);
	if (!Number.isFinite(used)) throw new Error(`用量接口的${label}窗口缺少 used_percent。`);
	if (!Number.isFinite(resetAt)) throw new Error(`用量接口的${label}窗口缺少 reset_at。`);
	return {
		usedPercent: Math.min(100, Math.max(0, Math.round(used))),
		resetAt: Math.round(resetAt * 1000),
		windowSeconds: Number.isFinite(Number(value.limit_window_seconds)) ? Number(value.limit_window_seconds) : null
	};
}

/**
 * 把用量接口的响应体读成界面要的数据。
 * @param body - 解析后的 JSON。
 * @returns 5 小时窗口、周窗口、套餐名与抓取时间。
 */
export function quotaFromBody(body) {
	if (body === null || typeof body !== 'object') throw new Error('用量接口没有返回 JSON 对象。');
	const rateLimit = body.rate_limit;
	if (rateLimit === null || typeof rateLimit !== 'object') {
		throw new Error('这个账号没有返回额度信息（可能不是订阅账号）。');
	}
	return {
		planType: typeof body.plan_type === 'string' ? body.plan_type : null,
		primary: readWindow(rateLimit.primary_window, '5 小时'),
		secondary: readWindow(rateLimit.secondary_window, '周')
	};
}

/** 组装一次用量请求的请求头。 */
function usageHeaders(credential) {
	const headers = { Authorization: `Bearer ${credential.access}`, Accept: 'application/json' };
	if (typeof credential.accountId === 'string' && credential.accountId.length > 0) {
		headers['ChatGPT-Account-Id'] = credential.accountId;
	}
	return headers;
}

/**
 * 查询一次官方额度。
 *
 * @param credential - pi-ai 的 Codex OAuth 凭据（`{access, refresh, expires, accountId}`）。
 * @param fetchImpl - 可注入的 fetch，便于测试。
 * @returns `{ quota, credential }`；`credential` 在没刷新时就是传入的那个对象。
 * @throws 网络失败、接口拒绝或响应格式不认得时抛中文错误。
 */
export async function fetchCodexQuota(credential, fetchImpl = fetch) {
	if (credential === null || typeof credential !== 'object' || typeof credential.access !== 'string' || credential.access.length === 0) {
		throw new Error('凭据库里没有可用的 ChatGPT 访问令牌。');
	}
	let active = credential;
	let response = await request(USAGE_URL, { method: 'GET', headers: usageHeaders(active) }, fetchImpl);
	if (response.status === 401 || response.status === 403) {
		active = await refreshCodexToken(credential.refresh, fetchImpl);
		response = await request(USAGE_URL, { method: 'GET', headers: usageHeaders(active) }, fetchImpl);
	}
	if (response.status === 401 || response.status === 403) throw new Error('ChatGPT 凭据已失效，请重新登录。');
	if (!response.ok) throw new Error(`ChatGPT 用量查询失败（HTTP ${response.status}）。`);
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error('ChatGPT 用量接口没有返回 JSON。');
	}
	return { quota: quotaFromBody(body), credential: active };
}

/**
 * 用 refresh_token 换一组新的令牌。
 * @param refreshToken - 凭据里的 refresh token。
 * @param fetchImpl - 可注入的 fetch。
 * @returns 新的 `{access, refresh, expires, accountId}`。
 */
export async function refreshCodexToken(refreshToken, fetchImpl = fetch) {
	if (typeof refreshToken !== 'string' || refreshToken.length === 0) throw new Error('ChatGPT 凭据已过期，请重新登录。');
	const response = await request(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken })
	}, fetchImpl);
	if (!response.ok) throw new Error(`ChatGPT 令牌刷新失败（HTTP ${response.status}）。`);
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error('ChatGPT 令牌刷新没有返回 JSON。');
	}
	if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string' || !Number.isFinite(Number(body.expires_in))) {
		throw new Error('ChatGPT 令牌刷新响应缺少字段。');
	}
	const accountId = decodeJwt(body.access_token)?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
	return {
		type: 'oauth',
		access: body.access_token,
		refresh: body.refresh_token,
		expires: Date.now() + Number(body.expires_in) * 1000,
		...(typeof accountId === 'string' && accountId.length > 0 ? { accountId } : {})
	};
}

/** 带超时的 fetch：网络层卡住时按同一个错误路径收场。 */
async function request(url, init, fetchImpl) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, REQUEST_TIMEOUT_MS);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) throw new Error('ChatGPT 用量查询超时。');
		throw new Error(`连接 ChatGPT 失败：${error?.message ?? String(error)}`);
	} finally {
		clearTimeout(timer);
	}
}

/** 读 JWT 载荷；解析不了就返回 null。 */
function decodeJwt(token) {
	try {
		const payload = String(token).split('.')[1];
		if (payload === undefined) return null;
		const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
		return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}
