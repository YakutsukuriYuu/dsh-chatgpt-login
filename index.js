/**
 * ChatGPT (Codex) 订阅登录 — Host 半边。
 *
 * 这个插件不自己实现 OAuth：`@deepseek-ai/dsh-llm-pi-ai` 已经为 pi-ai 目录里
 * 的 `openai-codex` 注册了授权流（凭据记录键 `llm-pi-ai/openai-codex`），登录后
 * 的 token 由凭据库保管并自动刷新。这里只做三件事：
 *
 * 1. 把那条授权流包成一个可从设置页调用的远程服务；
 * 2. 把流程里的“打开这个网址 / 输入这段验证码 / 请粘贴回调地址”转成设置页能渲染的数据；
 * 3. 把登录态、账号、过期时间、可用模型读出来给设置页显示；
 * 4. 用登录后的凭据去问官方用量接口，读出 5 小时窗口与周窗口的剩余额度。
 *
 * @module dsh-chatgpt-login
 */

import { fetchCodexQuota } from './quota.js';

/** 本插件版本，随状态一起回报，便于确认运行时加载的是哪一份代码。 */
const PLUGIN_VERSION = '1.1.0';
/** pi-ai 的 Codex 凭据记录键：`<scope>/<provider id>`。 */
const RECORD_KEY = 'llm-pi-ai/openai-codex';
/** Host 侧 Remote 标记所在的原型描述符键（见 @deepseek-ai/dsh-typert-protocol）。 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods';
/** 保留的通知条数，避免长时间登录刷爆状态载荷。 */
const MAX_NOTICES = 40;
/** 额度结果复用窗口：这段时间内的重复查询直接返回上一次结果。 */
const QUOTA_CACHE_MS = 60_000;
/** 本插件导出的远程方法；名字必须与原型上的方法名一致。 */
const REMOTE_METHOD_NAMES = Object.freeze(['status', 'login', 'cancel', 'answer', 'logout', 'quota']);

/**
 * 把任意抛出物渲染成一行人类可读文本。
 * @param error - 捕获到的值。
 * @returns 文本，或 null 表示没有错误。
 */
function errorText(error) {
	if (error === undefined || error === null) return null;
	if (typeof error === 'string') return error;
	const message = typeof error.message === 'string' ? error.message : undefined;
	const code = typeof error.code === 'string' ? error.code : undefined;
	if (message !== undefined && code !== undefined) return `${message} (${code})`;
	if (message !== undefined) return message;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * 设置页要的 ChatGPT 登录服务。
 *
 * 服务方法都返回纯 JSON，因为远程调用会做一次跨进程克隆。
 *
 * 只 import 相对路径的 `quota.js`：外部安装的 bundle 解析不了 `@deepseek-ai/*`
 * 裸包名，所以服务用 `ctx.provide` 注册，Typert 绑定与标记也手写。
 */
class ChatGptLogin {
	constructor(ctx, config) {
		this.ctx = ctx;
		/** Typert Gateway 的可见绑定：让这个服务的方法成为可远程调用的端点。 */
		this.typertRemote = Object.freeze({
			service: this,
			serviceKey: 'chatgptLogin',
			namespace: 'chatgptLogin'
		});
		this.config = config ?? {};
		/** 最近的流程通知（网址、验证码、进度）。 */
		this.notices = [];
		/** 当前等待用户回答的提问，形如 {kind, message, placeholder, resolve, reject}。 */
		this.pending = null;
		this.inFlight = false;
		this.method = null;
		this.failure = null;
		this.quotaFailure = null;
		this.quotaSnapshot = null;
		this.quotaFetchedAt = 0;
		this.quotaInFlight = null;
		/** 每次登出/换账号自增，用来丢弃过期请求的结果。 */
		this.quotaGeneration = 0;
		this.controller = null;
		this.run = null;
		ctx.effect(() => () => {
			this.controller?.abort();
			this.settlePrompt(undefined, new Error('插件已卸载'));
		}, 'chatgpt-login: 卸载时取消进行中的登录');
	}

	/** 记录一条流程通知，超出上限时丢最旧的。 */
	pushNotice(notice) {
		const message = typeof notice?.message === 'string' ? notice.message : String(notice ?? '');
		this.notices.push({
			message,
			...(typeof notice?.url === 'string' ? { url: notice.url } : {}),
			...(typeof notice?.code === 'string' ? { code: notice.code } : {})
		});
		if (this.notices.length > MAX_NOTICES) this.notices.splice(0, this.notices.length - MAX_NOTICES);
	}

	/** 结束当前提问：resolve 传答案，reject 传失败原因。 */
	settlePrompt(value, error) {
		const pending = this.pending;
		if (pending === null) return;
		this.pending = null;
		if (error === undefined) pending.resolve(value);
		else pending.reject(error);
	}

	/**
	 * 把授权流的一次提问交给设置页；设置页通过 `answer` 回答。
	 * @param prompt - 授权流的提问（kind/message/placeholder）。
	 * @returns 用户输入或验证码。
	 */
	ask(prompt) {
		this.settlePrompt(undefined, new Error('已被新的提问替代'));
		const options = Array.isArray(prompt?.options)
			? prompt.options
				.filter((option) => option !== null && typeof option === 'object' && typeof option.id === 'string')
				.map((option) => ({
					id: option.id,
					label: typeof option.label === 'string' ? option.label : option.id,
					...(typeof option.description === 'string' ? { description: option.description } : {})
				}))
			: [];
		return new Promise((resolve, reject) => {
			this.pending = {
				kind: typeof prompt?.kind === 'string' ? prompt.kind : 'text',
				message: typeof prompt?.message === 'string' ? prompt.message : '请输入',
				...(typeof prompt?.placeholder === 'string' ? { placeholder: prompt.placeholder } : {}),
				options,
				resolve,
				reject
			};
		});
	}

	/** 读凭据记录里的账号与过期时间。 */
	async readRecord(credentials) {
		if (credentials === undefined) return { signedIn: false, kind: null, accountId: null, expiresAt: null };
		try {
			const record = await credentials.readRecord(RECORD_KEY);
			if (record === undefined) return { signedIn: false, kind: null, accountId: null, expiresAt: null };
			const payload = record.kind === 'grant' ? record.payload : undefined;
			const accountId = typeof payload?.accountId === 'string' ? payload.accountId : null;
			const expiresAt = typeof payload?.expires === 'number' ? payload.expires : null;
			return { signedIn: true, kind: record.kind, accountId, expiresAt };
		} catch (error) {
			this.failure = errorText(error);
			return { signedIn: false, kind: null, accountId: null, expiresAt: null };
		}
	}

	/** 读 `openai-codex` 路由当前可用的模型 id。 */
	async readModels() {
		const llm = this.ctx.get('llm');
		if (llm === undefined) return [];
		try {
			const models = await llm.listModels('openai-codex');
			if (!Array.isArray(models)) return [];
			return models
				.map((model) => (typeof model?.id === 'string' ? model.id : undefined))
				.filter((id) => id !== undefined)
				.slice(0, 32);
		} catch {
			return [];
		}
	}

	/**
	 * 当前登录状态；设置页挂载时读一次，登录进行中按秒轮询。
	 * @returns 状态、可用登录方式、待答提问、通知与错误。
	 */
	async status() {
		const authorization = this.ctx.get('authorization');
		const credentials = this.ctx.get('credentials');
		let flow;
		try {
			flow = authorization?.describe?.(RECORD_KEY);
		} catch (error) {
			this.failure = errorText(error);
		}
		const record = await this.readRecord(credentials);
		return {
			version: PLUGIN_VERSION,
			flowAvailable: flow !== undefined,
			methods: (flow?.methods ?? []).map((method) => ({ id: String(method.id), label: String(method.label) })),
			signedIn: record.signedIn,
			kind: record.kind,
			accountId: record.accountId,
			expiresAt: record.expiresAt,
			inFlight: this.inFlight,
			method: this.method,
			prompt: this.pending === null ? null : {
				kind: this.pending.kind,
				message: this.pending.message,
				placeholder: this.pending.placeholder ?? null,
				options: this.pending.options
			},
			notices: this.notices.map((notice) => ({
				message: notice.message,
				url: notice.url ?? null,
				code: notice.code ?? null
			})),
			error: this.failure,
			models: await this.readModels(),
			quota: record.signedIn ? this.quotaSnapshot : null,
			quotaError: record.signedIn ? this.quotaFailure : null
		};
	}

	/** 丢掉缓存的额度快照（登出、换账号时调用）。 */
	forgetQuota() {
		// 世代号让登出前发出的请求回来后不再写回状态。
		this.quotaGeneration += 1;
		this.quotaSnapshot = null;
		this.quotaFetchedAt = 0;
		this.quotaFailure = null;
		this.quotaInFlight = null;
	}

	/**
	 * 读取官方 Codex 额度（5 小时窗口 + 周窗口）。
	 *
	 * 两条约束：
	 * - 一分钟内重复调用共用上一次结果；多个界面同时刷新时共用同一个在途请求。
	 * - 令牌刷新走 `credentials.modifyRecord`，让“读旧凭据 → 换新令牌 → 写回”
	 *   落在同一把写锁里，避免和 pi-ai 自己的刷新互相覆盖。
	 *
	 * @param force - true 时忽略一分钟缓存。远程方法不能有默认值/解构/剩余参数，
	 *   所以这里保留裸参数并自己判 `true`。
	 * @returns `{quota, error}`，两者都可能是 null。
	 */
	async quota(force) {
		const credentials = this.ctx.get('credentials');
		if (credentials === undefined) return { quota: null, error: '当前组合没有凭据库。' };
		if (force !== true && this.quotaSnapshot !== null && Date.now() - this.quotaFetchedAt < QUOTA_CACHE_MS) {
			return { quota: this.quotaSnapshot, error: null };
		}
		if (this.quotaInFlight !== null) return this.quotaInFlight;
		this.quotaInFlight = this.readQuota(credentials).finally(() => {
			this.quotaInFlight = null;
		});
		return this.quotaInFlight;
	}

	/** `quota` 的实际取数逻辑；结果写进实例字段，供 `status` 复用。 */
	async readQuota(credentials) {
		const generation = this.quotaGeneration;
		try {
			const record = await credentials.readRecord(RECORD_KEY);
			if (record?.kind !== 'grant' || record.payload === null || typeof record.payload !== 'object') {
				if (generation === this.quotaGeneration) {
					this.quotaSnapshot = null;
					this.quotaFailure = '尚未登录 ChatGPT。';
				}
				return { quota: null, error: '尚未登录 ChatGPT。' };
			}
			let fresh = null;
			await credentials.modifyRecord(RECORD_KEY, async (current) => {
				if (current?.kind !== 'grant' || current.payload === null || typeof current.payload !== 'object') return undefined;
				const before = current.payload;
				const result = await fetchCodexQuota(before);
				fresh = result.quota;
				// 只有真的换了令牌才写回；否则保持记录原样，不制造无谓的写。
				return result.credential === before ? undefined : { ...current, payload: result.credential };
			});
			// 取数期间登出或换了账号：这次结果作废。
			if (generation !== this.quotaGeneration) return { quota: null, error: '尚未登录 ChatGPT。' };
			if (fresh === null) {
				this.quotaFailure = '尚未登录 ChatGPT。';
				return { quota: null, error: this.quotaFailure };
			}
			this.quotaSnapshot = { ...fresh, fetchedAt: Date.now() };
			this.quotaFetchedAt = this.quotaSnapshot.fetchedAt;
			this.quotaFailure = null;
			return { quota: this.quotaSnapshot, error: null };
		} catch (error) {
			const message = errorText(error);
			if (generation !== this.quotaGeneration) return { quota: null, error: message };
			this.quotaFailure = message;
			return { quota: this.quotaSnapshot, error: message };
		}
	}

	/**
	 * 开始一次登录：浏览器回调方式或设备码方式.
	 * @param method - 授权流方式 id（`oauth` / `device_code`），省略用第一个可用方式。
	 * @returns 是否已启动，以及实际使用的方式。
	 */
	async login(method) {
		if (this.inFlight) return { started: false, error: '已有一次登录正在进行，请先取消。' };
		const authorization = this.ctx.get('authorization');
		if (authorization === undefined) {
			return { started: false, error: '当前组合没有 authorization 服务，无法执行登录。' };
		}
		const flow = authorization.describe(RECORD_KEY);
		if (flow === undefined) {
			return { started: false, error: '没有找到 openai-codex 授权流：请确认 @deepseek-ai/dsh-llm-pi-ai 已启用。' };
		}
		const wanted = typeof method === 'string' ? method : undefined;
		const chosen = flow.methods.some((entry) => entry.id === wanted) ? wanted : flow.methods[0]?.id;
		if (chosen === undefined) return { started: false, error: '该授权流没有可用方式。' };

		this.notices = [];
		this.failure = null;
		this.inFlight = true;
		this.method = chosen;
		this.controller = new AbortController();
		const interaction = {
			notify: (notice) => {
				this.pushNotice(notice);
			},
			prompt: (prompt) => this.ask(prompt)
		};
		this.run = authorization
			.begin({ key: RECORD_KEY, method: chosen, interaction, signal: this.controller.signal })
			.then((outcome) => {
				if (outcome?.status === 'authorized') {
					// OAuth URL 带有一次性 state / challenge；授权完成后不再留在页面上。
					this.notices = [];
					this.pushNotice({ message: '登录成功，已保存 ChatGPT 凭据。' });
					// 换了账号：上一个账号的额度不能继续显示。
					this.forgetQuota();
				} else this.pushNotice({ message: '登录已取消。' });
			})
			.catch((error) => {
				this.failure = errorText(error);
			})
			.finally(() => {
				this.inFlight = false;
				this.controller = null;
				this.run = null;
				this.settlePrompt(undefined, new Error('登录已结束'));
			});
		return { started: true, method: chosen };
	}

	/**
	 * 取消进行中的登录并撤回本次尝试。
	 * @returns 固定回执。
	 */
	async cancel() {
		try {
			this.ctx.get('authorization')?.cancel?.(RECORD_KEY);
		} catch (error) {
			this.failure = errorText(error);
		}
		this.controller?.abort();
		this.settlePrompt(undefined, new Error('用户已取消登录'));
		return { cancelled: true };
	}

	/**
	 * 回答授权流的提问（粘贴回调地址、输入设备码等）。
	 * @param text - 用户输入。
	 * @returns 是否真的有一个待答提问。
	 */
	async answer(text) {
		if (this.pending === null) return { answered: false };
		const pending = this.pending;
		this.pending = null;
		pending.resolve(typeof text === 'string' ? text : '');
		return { answered: true };
	}

	/**
	 * 退出登录：删除 pi-ai 的 Codex 凭据记录。
	 * @returns 回执。
	 */
	async logout() {
		const credentials = this.ctx.get('credentials');
		if (credentials === undefined) return { signedOut: false, error: '当前组合没有凭据库。' };
		try {
			await credentials.deleteRecord(RECORD_KEY);
			this.failure = null;
			this.notices = [];
			this.forgetQuota();
			return { signedOut: true };
		} catch (error) {
			this.failure = errorText(error);
			return { signedOut: false, error: this.failure };
		}
	}
}

/**
 * 手写 Remote 方法标记：没有构建步骤的动态插件用不了装饰器，
 * 就直接写 Typert 协议读取的那个原型描述符。
 */
Object.defineProperty(ChatGptLogin.prototype, REMOTE_METHODS, {
	configurable: true,
	value: Object.freeze({
		version: 1,
		methods: Object.freeze(REMOTE_METHOD_NAMES.map((method) => Object.freeze({
			method,
			invocation: Object.freeze({ kind: 'direct' })
		})))
	})
});

/**
 * 插件入口：把服务注册到当前 fiber（随插件卸载自动撤销）。
 * @param ctx - 插件自己的 Cordis 上下文。
 * @param config - 行配置，本插件不需要。
 */
export function apply(ctx, config) {
	ctx.provide('chatgptLogin', new ChatGptLogin(ctx, config));
}
