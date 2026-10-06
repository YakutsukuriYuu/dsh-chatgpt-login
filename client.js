/**
 * ChatGPT (Codex) 订阅登录 — Client 半边。
 *
 * 提供三个渲染面：
 * - `settings.section`：设置里的独立一页，完整登录面板 + 额度小结。
 * - `settings.models.provider-card`：模型页 `openai-codex` 卡片上的内联登录入口。
 * - `conversation.composer.dock`：输入框下方状态区里的额度胶囊，显示 5 小时与周额度，
 *   悬停展开重置时间，点击强制刷新。
 *
 * 浏览器半边不做任何网络与 OAuth：它通过本包的 Remote 命名空间调用 Host 半边。
 * 文案走 Harness 的 locale 服务，跟随应用语言（缺省中文）。
 *
 * @module dsh-chatgpt-login/client
 */
window.__ModuleLoader__.load({
	id: 'dsh-chatgpt-login',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const { useCallback, useEffect, useState } = React;

		const PACKAGE = 'dsh-chatgpt-login';
		const NAMESPACE = 'chatgptLogin';
		const LOCALE_NS = 'chatgpt-login';
		const SETTINGS_NS = 'llm-pi-ai';
		const PROVIDER = 'openai-codex';

		/** 两种语言的完整字典：活动语言是英文时按 fallback 找英文，中文则逐条命中。 */
		const DICT = {
			zh: {
				nav: 'ChatGPT 订阅',
				title: 'ChatGPT 订阅（Codex）',
				desc: '用 ChatGPT Plus / Pro 订阅登录后，就能在模型菜单里选择 GPT 系列模型，按订阅额度计费，不需要 API Key。',
				loading: '读取状态中…',
				signedIn: '已登录 ChatGPT',
				signedOut: '未登录',
				expired: '已过期，下次请求会自动刷新',
				expiresMinutes: '约 {minutes} 分钟后过期',
				expiresHours: '约 {hours} 小时后过期',
				login: '登录 ChatGPT',
				relogin: '重新登录',
				deviceLogin: '用设备码登录',
				cancelLogin: '取消登录',
				logout: '退出登录',
				refresh: '刷新状态',
				submit: '提交',
				noflow: '没有找到 openai-codex 授权流：请确认 @deepseek-ai/dsh-llm-pi-ai 已启用，并在模型页添加 openai-codex provider。',
				modelsLabel: '可在模型菜单里选择：',
				remoteMissing: 'Host 远程服务未挂载，请重启 DSH 后再试。',
				callFailed: '调用失败',
				quota5h: '5小时',
				quotaWeek: '周',
				quotaLoading: '额度读取中…',
				quotaUnavailable: '额度不可用',
				quotaTitle: 'ChatGPT 订阅额度',
				quotaRemaining: '剩余 {percent}%',
				quotaResetsIn: '{time}后重置',
				quotaResetsDone: '即将重置',
				quotaRefresh: '刷新',
				quotaRefreshing: '刷新中…',
				quotaUpdated: '更新于 {time}',
				quotaHint: '点击刷新重新查询',
				quotaPlan: '套餐',
				quotaSignInFirst: '登录 ChatGPT 后可查看额度。',
				durationDays: '{days} 天 {hours} 小时',
				durationHours: '{hours} 小时 {minutes} 分',
				durationMinutes: '{minutes} 分',
				durationSeconds: '不到 1 分',
				dayToday: '今天',
				dayTomorrow: '明天',
				monthDay: '{month}月{day}日'
			},
			en: {
				nav: 'ChatGPT',
				title: 'ChatGPT subscription (Codex)',
				desc: 'Sign in with your ChatGPT Plus / Pro subscription to use the GPT models from the model menu — billed to your subscription, no API key needed.',
				loading: 'Loading status…',
				signedIn: 'Signed in to ChatGPT',
				signedOut: 'Not signed in',
				expired: 'expired; refreshes on the next request',
				expiresMinutes: 'expires in about {minutes} min',
				expiresHours: 'expires in about {hours} h',
				login: 'Sign in with ChatGPT',
				relogin: 'Sign in again',
				deviceLogin: 'Use a device code',
				cancelLogin: 'Cancel sign-in',
				logout: 'Sign out',
				refresh: 'Refresh',
				submit: 'Submit',
				noflow: 'The openai-codex authorization flow is missing: make sure @deepseek-ai/dsh-llm-pi-ai is enabled and the openai-codex provider is added on the Models page.',
				modelsLabel: 'Available in the model menu:',
				remoteMissing: 'The Host remote service is not mounted. Restart DSH and try again.',
				callFailed: 'Call failed',
				quota5h: '5h',
				quotaWeek: 'Week',
				quotaLoading: 'Reading quota…',
				quotaUnavailable: 'Quota unavailable',
				quotaTitle: 'ChatGPT subscription quota',
				quotaRemaining: '{percent}% left',
				quotaResetsIn: 'resets in {time}',
				quotaResetsDone: 'resets shortly',
				quotaRefresh: 'Refresh',
				quotaRefreshing: 'Refreshing…',
				quotaUpdated: 'updated {time}',
				quotaHint: 'Click refresh to re-check',
				quotaPlan: 'Plan',
				quotaSignInFirst: 'Sign in to ChatGPT to see your quota.',
				durationDays: '{days}d {hours}h',
				durationHours: '{hours}h {minutes}m',
				durationMinutes: '{minutes}m',
				durationSeconds: 'under a minute',
				dayToday: 'today',
				dayTomorrow: 'tomorrow',
				monthDay: '{month}/{day}'
			}
		};

		/** 未接上 locale 服务时（例如组合里没有它）直接显示中文。 */
		let translate = null;
		const t = (key, params) => {
			if (translate === null) {
				const template = DICT.zh[key] ?? key;
				return params === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
			}
			return translate(key, params);
		};

		/** 调用本包 Host 半边的方法。 */
		let invoke = null;

		/** 远程描述符要求 strict 编解码器；值本身是纯 JSON，不需要额外校验。 */
		function jsonCodec(typeSymbol) {
			return {
				mode: 'strict',
				typeSymbol,
				create: () => ({ parse: (value) => value })
			};
		}

		/**
		 * 组装一条远程方法描述符。
		 * @param method - Host 原型上的方法名。
		 * @param parameters - 线上的参数名，顺序与方法签名一致。
		 * @param optional - 允许调用方省略的参数名（网关据此放宽 missing 检查）。
		 */
		function descriptor(method, parameters, optional = []) {
			return {
				id: `${PACKAGE}#${NAMESPACE}/${method}`,
				service: NAMESPACE,
				namespace: NAMESPACE,
				method,
				implementation: method,
				invocation: { kind: 'direct' },
				parameters: parameters.map((wire) => ({
					name: wire,
					wire,
					source: 'json',
					codec: jsonCodec(`${PACKAGE}#${NAMESPACE}/${method}:${wire}`),
					...(optional.includes(wire) ? { acceptsUndefined: true } : {})
				})),
				result: jsonCodec(`${PACKAGE}#${NAMESPACE}/${method}:result`)
			};
		}

		const CONTRIBUTION = {
			package: PACKAGE,
			descriptors: [
				descriptor('status', []),
				descriptor('login', ['method']),
				descriptor('cancel', []),
				descriptor('answer', ['text']),
				descriptor('logout', []),
				descriptor('quota', ['force'], ['force'])
			]
		};

		/** 样式：容器与文字用主题 token，按钮沿用宿主的主/次按钮 token 以免文字与底色撞色。 */
		const styles = {
			card: {
				border: '1px solid var(--dsw-alias-border-l1)',
				borderRadius: 12,
				padding: '16px 18px',
				background: 'var(--dsw-alias-bg-layer-1)',
				display: 'flex',
				flexDirection: 'column',
				gap: 10,
				maxWidth: 760
			},
			inline: {
				border: '1px solid var(--dsw-alias-border-l1)',
				borderRadius: 10,
				padding: '10px 12px',
				background: 'var(--dsw-alias-bg-layer-2)',
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				marginTop: 8
			},
			title: {
				margin: 0,
				fontSize: 15,
				fontWeight: 600,
				color: 'var(--dsw-alias-label-primary)'
			},
			subtitle: {
				margin: 0,
				fontSize: 13,
				lineHeight: '20px',
				color: 'var(--dsw-alias-label-secondary)'
			},
			row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
			status: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
			dot: (on) => ({
				width: 8,
				height: 8,
				borderRadius: 4,
				flex: '0 0 auto',
				background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)'
			}),
			primaryButton: {
				border: '1px solid transparent',
				borderRadius: 8,
				padding: '7px 14px',
				fontSize: 13,
				fontWeight: 500,
				cursor: 'pointer',
				color: 'var(--dsw-alias-label-primary-foreground)',
				background: 'var(--dsw-alias-button-primary-fill)'
			},
			secondaryButton: {
				border: '1px solid var(--dsw-alias-border-l2)',
				borderRadius: 8,
				padding: '7px 14px',
				fontSize: 13,
				cursor: 'pointer',
				color: 'var(--dsw-alias-label-primary)',
				background: 'transparent'
			},
			disabledButton: { opacity: 0.45, cursor: 'default' },
			dangerButton: {
				border: '1px solid var(--dsw-alias-border-l2)',
				borderRadius: 8,
				padding: '7px 14px',
				fontSize: 13,
				cursor: 'pointer',
				color: 'var(--dsw-alias-state-error-primary)',
				background: 'transparent'
			},
			notice: {
				fontSize: 13,
				lineHeight: '20px',
				color: 'var(--dsw-alias-label-secondary)',
				display: 'flex',
				flexDirection: 'column',
				gap: 4,
				margin: 0,
				padding: 0,
				listStyle: 'none'
			},
			link: { color: 'var(--dsw-alias-brand-primary)', wordBreak: 'break-all' },
			code: {
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
				fontSize: 14,
				letterSpacing: 1,
				color: 'var(--dsw-alias-label-primary)'
			},
			input: {
				flex: '1 1 240px',
				minWidth: 200,
				border: '1px solid var(--dsw-alias-border-l2)',
				borderRadius: 8,
				padding: '6px 10px',
				fontSize: 13,
				color: 'var(--dsw-alias-label-primary)',
				background: 'var(--dsw-alias-bg-base)'
			},
			error: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary)', margin: 0 },
			chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
			chip: {
				fontSize: 12,
				padding: '2px 8px',
				borderRadius: 999,
				border: '1px solid var(--dsw-alias-border-l1)',
				color: 'var(--dsw-alias-label-secondary)'
			}
		};

		/** 过期时间渲染：返回 null 表示没有可显示的信息。 */
		function formatRemaining(expiresAt) {
			if (typeof expiresAt !== 'number') return null;
			const minutes = Math.round((expiresAt - Date.now()) / 60000);
			if (!Number.isFinite(minutes)) return null;
			if (minutes <= 0) return t('expired');
			if (minutes < 60) return t('expiresMinutes', { minutes });
			return t('expiresHours', { hours: Math.round(minutes / 60) });
		}

		/** 账号展示：只露头尾。 */
		function shortAccount(accountId) {
			if (typeof accountId !== 'string' || accountId.length === 0) return null;
			if (accountId.length <= 12) return accountId;
			return `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;
		}

		// ------------------------------------------------------------------
		// 额度条：注入在输入框下方的状态区（`conversation.composer.dock`），
		// 与自带的 tok/s、缓存命中那排胶囊并排。
		// ------------------------------------------------------------------

		/** 样式表：用主题 token，并带一个 `data-plugin-css` 标记避免重复注入。 */
		const QUOTA_CSS = [
			'.cgqRoot{position:relative;display:inline-flex;min-width:0;align-items:center}',
			'.cgqPill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;',
			'line-height:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);white-space:nowrap;background:0 0;border:none;',
			'border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}',
			'.cgqPill:hover,.cgqPill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.cgqPill:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
			'.cgqDot{width:6px;height:6px;border-radius:3px;flex:none;background:currentColor;opacity:.8}',
			'.cgqStrong{color:var(--dsw-alias-label-secondary);font-weight:500}',
			'.cgqSep{color:var(--dsw-alias-separator-primary);margin:0 4px}',
			'.cgqWarn{color:var(--dsw-alias-state-warn-primary)}',
			'.cgqLow{color:var(--dsw-alias-state-error-primary)}',
			'.cgqCard{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);z-index:40;box-sizing:border-box;',
			'width:320px;max-width:min(320px,86vw);border-radius:var(--dsw-radius-lg);border:1px solid var(--dsw-alias-border-l1);',
			'background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);',
			'color:var(--dsw-alias-label-secondary);padding:10px 12px;font-size:12px;line-height:18px;display:flex;flex-direction:column;',
			'gap:9px;text-align:left}',
			'.cgqCardTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px}',
			'.cgqPlan{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-weight:400;font-size:12px}',
			'.cgqRow{display:flex;flex-direction:column;gap:2px;min-width:0}',
			'.cgqRowHead{display:flex;align-items:center;gap:8px;min-width:0}',
			'.cgqRowLabel{color:var(--dsw-alias-label-primary);flex:0 0 38px;white-space:nowrap}',
			// 进度条：轨道与填充都必须 display:block，否则 inline 的 span 不吃宽高。
			'.cgqBar{display:block;height:5px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;flex:1 1 auto;min-width:36px}',
			'.cgqBarFill{display:block;height:100%;border-radius:3px;background:var(--dsw-alias-state-success-primary);transition:width .2s}',
			'.cgqBarFill.cgqWarn{background:var(--dsw-alias-state-warn-primary)}',
			'.cgqBarFill.cgqLow{background:var(--dsw-alias-state-error-primary)}',
			'.cgqPct{flex:0 0 auto;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
			'.cgqMeta{padding-left:46px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.cgqFoot{color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:8px;border-top:.5px solid var(--dsw-alias-border-l1);',
			'padding-top:7px}',
			'.cgqLink{margin-left:auto;color:var(--dsw-alias-brand-primary);background:0 0;border:none;padding:0;font:inherit;cursor:pointer}',
			'.cgqErr{color:var(--dsw-alias-state-error-primary)}'
		].join('');

		/** 注入一次额度条样式；重复 apply（HMR）不会重复插入。 */
		function injectQuotaStyles() {
			if (typeof document === 'undefined') return;
			const marker = `${PACKAGE}/quota.css`;
			if (document.querySelector(`style[data-plugin-css="${marker}"]`) !== null) return;
			const tag = document.createElement('style');
			tag.dataset.plugin = PACKAGE;
			tag.dataset.pluginCss = marker;
			tag.textContent = QUOTA_CSS;
			document.head.appendChild(tag);
		}

		/** 剩余百分比 → 健康档位。 */
		function quotaHealth(remaining) {
			if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return 'ok';
			if (remaining <= 15) return 'low';
			if (remaining <= 40) return 'warn';
			return 'ok';
		}

		/** 健康档位 → class 名。 */
		function healthClass(health) {
			if (health === 'low') return ' cgqLow';
			if (health === 'warn') return ' cgqWarn';
			return '';
		}

		/** 已用百分比 → 剩余百分比。 */
		function remainingOf(window) {
			const used = window?.usedPercent;
			if (typeof used !== 'number' || !Number.isFinite(used)) return null;
			return Math.min(100, Math.max(0, 100 - used));
		}

		/** 距离重置还有多久：返回本地化文案。 */
		function formatCountdown(resetAt) {
			if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return null;
			const ms = resetAt - Date.now();
			if (ms <= 0) return t('quotaResetsDone');
			const minutes = Math.floor(ms / 60000);
			if (minutes < 1) return t('durationSeconds');
			const hours = Math.floor(minutes / 60);
			if (hours < 1) return t('durationMinutes', { minutes });
			const days = Math.floor(hours / 24);
			if (days < 1) return t('durationHours', { hours, minutes: minutes % 60 });
			return t('durationDays', { days, hours: hours % 24 });
		}

		/** 重置时刻：今天/明天只显示时间，更远显示日期。 */
		function formatResetClock(resetAt) {
			if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return null;
			const at = new Date(resetAt);
			const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
			const midnight = new Date();
			midnight.setHours(0, 0, 0, 0);
			const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - midnight.getTime()) / 86_400_000);
			if (days <= 0) return `${t('dayToday')} ${clock}`;
			if (days === 1) return `${t('dayTomorrow')} ${clock}`;
			return `${t('monthDay', { month: at.getMonth() + 1, day: at.getDate() })} ${clock}`;
		}

		/** 套餐名：接口给的是 `plus` 这种小写。 */
		function planLabel(planType) {
			if (typeof planType !== 'string' || planType.length === 0) return null;
			// Pro 账号的 plan_type 实际是 "prolite"（openai/codex#29243），显示成 Pro。
			if (planType === 'prolite') return 'Pro';
			return planType.charAt(0).toUpperCase() + planType.slice(1);
		}

		/** 更新时间只显示时分。 */
		function formatUpdatedAt(fetchedAt) {
			if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;
			const at = new Date(fetchedAt);
			return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
		}

		/**
		 * 读额度：登录后才请求；每 5 分钟自动刷新一次，点胶囊可强制刷新。
		 * @returns 状态、额度、错误与刷新函数。
		 */
		function useQuota() {
			const [snapshot, setSnapshot] = useState({ status: null, quota: null, error: null, loading: true });
			const [busy, setBusy] = useState(false);
			const load = useCallback(async (force) => {
				if (force === true) setBusy(true);
				try {
					const status = await invoke('status');
					if (status?.signedIn !== true) {
						setSnapshot({ status, quota: null, error: null, loading: false });
						return;
					}
					const result = await invoke('quota', force === true);
					setSnapshot({
						status,
						quota: result?.quota ?? null,
						error: result?.error ?? null,
						loading: false
					});
				} catch (error) {
					setSnapshot((previous) => ({ ...previous, error: error?.message ?? String(error), loading: false }));
				} finally {
					if (force === true) setBusy(false);
				}
			}, []);
			useEffect(() => {
				load(false);
			}, [load]);
			useEffect(() => {
				const timer = setInterval(() => {
					load(true);
				}, 300_000);
				return () => clearInterval(timer);
			}, [load]);
			return { ...snapshot, busy, refresh: () => load(true) };
		}

		/**
		 * 弹层里的一行：窗口名 + 进度条 + 剩余百分比，第二行是重置时间。
		 * 重置时间单独占一行，避免字数多时把卡片撑破。
		 */
		function QuotaRow(props) {
			const remaining = remainingOf(props.window);
			const health = quotaHealth(remaining);
			const countdown = formatCountdown(props.window?.resetAt);
			const clock = formatResetClock(props.window?.resetAt);
			// 第二行只讲重置：已用多少从进度条和剩余百分比就能读出来。
			const meta = [countdown === null ? null : t('quotaResetsIn', { time: countdown }), clock]
				.filter((part) => part !== null)
				.join(' · ');
			return h('div', { className: 'cgqRow' }, [
				h('div', { key: 'head', className: 'cgqRowHead' }, [
					h('span', { key: 'label', className: 'cgqRowLabel' }, props.label),
					h('span', { key: 'bar', className: 'cgqBar' }, h('span', {
						className: `cgqBarFill${healthClass(health)}`,
						style: { width: `${remaining ?? 0}%` }
					})),
					h('span', { key: 'pct', className: `cgqPct${healthClass(health)}` }, t('quotaRemaining', { percent: remaining ?? 0 }))
				]),
				meta.length === 0 ? null : h('div', { key: 'meta', className: 'cgqMeta' }, meta)
			]);
		}

		/** 额度弹层内容：两个窗口、套餐、更新时间与刷新按钮。 */
		function QuotaCard(props) {
			const quota = props.quota;
			const updated = formatUpdatedAt(quota?.fetchedAt);
			const plan = planLabel(quota?.planType);
			return h('div', { className: 'cgqCard' }, [
				h('div', { key: 'title', className: 'cgqCardTitle' }, [
					t('quotaTitle'),
					plan === null ? null : h('span', { key: 'plan', className: 'cgqPlan' }, `${t('quotaPlan')} ${plan}`)
				]),
				quota?.primary == null ? null : h(QuotaRow, { key: 'primary', label: t('quota5h'), window: quota.primary }),
				quota?.secondary == null ? null : h(QuotaRow, { key: 'secondary', label: t('quotaWeek'), window: quota.secondary }),
				props.error === null ? null : h('div', { key: 'error', className: 'cgqErr' }, props.error),
				h('div', { key: 'foot', className: 'cgqFoot' }, [
					h('span', { key: 'hint' }, updated === null ? t('quotaHint') : t('quotaUpdated', { time: updated })),
					h('button', {
						key: 'refresh',
						type: 'button',
						className: 'cgqLink',
						disabled: props.busy === true,
						onClick: () => {
							props.refresh();
						}
					}, props.busy === true ? t('quotaRefreshing') : t('quotaRefresh'))
				])
			]);
		}

		/** 输入框下方状态区里的额度胶囊。 */
		function QuotaDock() {
			const { status, quota, error, loading, busy, refresh } = useQuota();
			const [pinned, setPinned] = useState(false);
			const [hovered, setHovered] = useState(false);
			// 没登录就不占用这一行。注意这个提前返回必须在所有 hook 之后，
			// 否则“先加载后登录”会让 hook 数量变化。
			if (status !== null && status.signedIn !== true) return null;
			const open = pinned || hovered;
			const primaryRemaining = remainingOf(quota?.primary);
			const secondaryRemaining = remainingOf(quota?.secondary);
			const worst = [primaryRemaining, secondaryRemaining]
				.filter((value) => typeof value === 'number')
				.sort((left, right) => left - right)[0];
			const health = error !== null ? 'low' : quotaHealth(worst);
			let compact;
			if (quota === null) {
				compact = h('span', { key: 'text', className: 'cgqStrong' }, loading ? t('quotaLoading') : t('quotaUnavailable'));
			} else {
				// Pro 套餐只有周窗口（5 小时窗口为 null），只渲染接口实际给了的窗口。
				const children = [];
				if (quota.primary != null) children.push(`${t('quota5h')} ${primaryRemaining ?? 0}%`);
				if (quota.secondary != null) {
					if (children.length > 0) children.push(h('span', { key: 'sep', className: 'cgqSep' }, '·'));
					children.push(`${t('quotaWeek')} ${secondaryRemaining ?? 0}%`);
				}
				compact = h('span', { key: 'text', className: 'cgqStrong' }, children);
			}
			return h('div', {
				className: 'cgqRoot',
				onMouseEnter: () => setHovered(true),
				onMouseLeave: () => setHovered(false)
			}, [
				h('button', {
					key: 'pill',
					type: 'button',
					className: `cgqPill${healthClass(health)}`,
					'aria-expanded': open,
					'aria-label': t('quotaTitle'),
					onFocus: () => setHovered(true),
					onBlur: () => setHovered(false),
					onClick: () => {
						const next = !pinned;
						setPinned(next);
						if (next) refresh();
					}
				}, [
					h('span', { key: 'dot', className: 'cgqDot' }),
					compact
				]),
				open ? h(QuotaCard, { key: 'card', quota, error, busy, refresh }) : null
			]);
		}

		/** 设置页里的额度小结：登录后显示两行文字；接口没给的窗口（如 Pro 没有 5 小时窗口）不显示。 */
		function QuotaSummary() {
			const { status, quota, error } = useQuota();
			if (status === null) return null;
			if (status.signedIn !== true) return h('p', { style: styles.subtitle }, t('quotaSignInFirst'));
			if (quota === null) return h('p', { style: styles.subtitle }, error ?? t('quotaLoading'));
			const usage = [];
			if (quota.primary != null) usage.push(`${t('quota5h')} ${t('quotaRemaining', { percent: remainingOf(quota.primary) ?? 0 })}`);
			if (quota.secondary != null) usage.push(`${t('quotaWeek')} ${t('quotaRemaining', { percent: remainingOf(quota.secondary) ?? 0 })}`);
			const resets = [];
			if (quota.primary != null) resets.push(`${t('quota5h')} ${formatResetClock(quota.primary.resetAt) ?? '—'}`);
			if (quota.secondary != null) resets.push(`${t('quotaWeek')} ${formatResetClock(quota.secondary.resetAt) ?? '—'}`);
			return h('div', { style: { ...styles.row, flexDirection: 'column', alignItems: 'flex-start', gap: 4 } }, [
				h('span', { key: 'primary', style: styles.subtitle }, `${t('quotaTitle')} · ${usage.join(' · ')}`),
				h('span', { key: 'reset', style: { ...styles.subtitle, fontSize: 12 } }, resets.join('  |  '))
			]);
		}

		/** 读状态；登录进行中或等待输入时按秒轮询。 */
		function useLoginStatus() {
			const [status, setStatus] = useState(null);
			const [failure, setFailure] = useState(null);
			const refresh = useCallback(async () => {
				try {
					setStatus(await invoke('status'));
					setFailure(null);
				} catch (error) {
					setFailure(error?.message ?? String(error));
				}
			}, []);
			useEffect(() => {
				refresh();
			}, [refresh]);
			const busy = status !== null && (status.inFlight === true || status.prompt !== null);
			useEffect(() => {
				if (!busy) return undefined;
				const timer = setInterval(refresh, 1200);
				return () => clearInterval(timer);
			}, [busy, refresh]);
			return { status, failure, refresh };
		}

		/** 状态行：登录点、账号、过期时间。 */
		function StatusLine(props) {
			const status = props.status;
			if (status === null) {
				return h('div', { style: styles.status }, [
					h('span', { key: 'dot', style: styles.dot(false) }),
					h('span', { key: 'text' }, t('loading'))
				]);
			}
			const signedIn = status.signedIn === true;
			const account = shortAccount(status.accountId);
			const remaining = formatRemaining(status.expiresAt);
			return h('div', { style: styles.status }, [
				h('span', { key: 'dot', style: styles.dot(signedIn) }),
				h('span', { key: 'text' }, signedIn ? t('signedIn') : t('signedOut')),
				account === null ? null : h('span', { key: 'account', style: { color: 'var(--dsw-alias-label-secondary)' } }, account),
				remaining === null ? null : h('span', { key: 'exp', style: { color: 'var(--dsw-alias-label-secondary)' } }, `· ${remaining}`)
			]);
		}

		/** 通知列表：授权网址、设备码、进度。 */
		function Notices(props) {
			let notices = Array.isArray(props.notices) ? props.notices : [];
			// 授权 URL 含一次性 OAuth 参数且很长；成功登录后只显示结果，不展示历史流程细节。
			if (props.signedIn === true) {
				notices = notices.filter((notice) => typeof notice?.url !== 'string' || notice.url.length === 0);
			}
			if (notices.length === 0) return null;
			const shown = notices.slice(-3).reverse();
			return h('ul', { style: styles.notice }, shown.map((notice, index) => h('li', {
				key: `${String(index)}-${notice.message}`
			}, [
				h('span', { key: 'message' }, notice.message),
				typeof notice.code === 'string' && notice.code.length > 0
					? h('div', { key: 'code', style: styles.code }, notice.code)
					: null,
				typeof notice.url === 'string' && notice.url.length > 0
					? h('div', { key: 'url' }, h('a', {
						href: notice.url,
						target: '_blank',
						rel: 'noreferrer',
						style: styles.link
					}, notice.url))
					: null
			])));
		}

		/** 待答提问：选择登录方式、粘贴回调地址、输入设备码。 */
		function PromptBox(props) {
			const prompt = props.prompt;
			const [text, setText] = useState('');
			useEffect(() => {
				setText('');
			}, [prompt?.message]);
			if (prompt === null) return null;
			const options = Array.isArray(prompt.options) ? prompt.options : [];
			const answer = async (value) => {
				try {
					await invoke('answer', value);
					setText('');
					await props.refresh();
				} catch (error) {
					props.onError(error?.message ?? String(error));
				}
			};
			const submit = async () => {
				const value = text.trim();
				if (value.length === 0) return;
				await answer(value);
			};
			if (options.length > 0) {
				return h('div', { style: { ...styles.row, flexDirection: 'column', alignItems: 'flex-start' } }, [
					h('span', { key: 'label', style: styles.subtitle }, prompt.message),
					h('div', { key: 'options', style: styles.row }, options.map((option) => h('button', {
						key: option.id,
						type: 'button',
						title: option.description ?? '',
						style: styles.primaryButton,
						onClick: () => answer(option.id)
					}, option.label)))
				]);
			}
			return h('div', { style: styles.row }, [
				h('span', { key: 'label', style: styles.subtitle }, prompt.message),
				h('input', {
					key: 'input',
					type: prompt.kind === 'secret' ? 'password' : 'text',
					value: text,
					placeholder: prompt.placeholder ?? '',
					style: styles.input,
					onChange: (event) => {
						setText(event.target.value);
					},
					onKeyDown: (event) => {
						if (event.key === 'Enter') submit();
					}
				}),
				h('button', {
					key: 'submit',
					type: 'button',
					style: { ...styles.primaryButton, ...(text.trim().length === 0 ? styles.disabledButton : {}) },
					disabled: text.trim().length === 0,
					onClick: submit
				}, t('submit'))
			]);
		}

		/** 登录动作组，独立页与 provider 卡片共用。 */
		function LoginActions(props) {
			const status = props.status;
			const [busy, setBusy] = useState(false);
			const run = async (work) => {
				setBusy(true);
				try {
					await work();
					await props.refresh();
				} catch (error) {
					props.onError(error?.message ?? String(error));
				} finally {
					setBusy(false);
				}
			};
			const inFlight = status?.inFlight === true;
			const methods = Array.isArray(status?.methods) ? status.methods : [];
			const browser = methods.find((method) => method.id === 'oauth') ?? methods[0];
			const device = methods.find((method) => method.id === 'device_code');
			const buttons = [];
			if (!inFlight) {
				if (browser !== undefined) buttons.push(h('button', {
					key: 'login',
					type: 'button',
					style: busy ? { ...styles.primaryButton, ...styles.disabledButton } : styles.primaryButton,
					disabled: busy || status?.flowAvailable !== true,
					onClick: () => run(() => invoke('login', browser.id))
				}, status?.signedIn === true ? t('relogin') : t('login')));
				if (device !== undefined) buttons.push(h('button', {
					key: 'device',
					type: 'button',
					style: styles.secondaryButton,
					disabled: busy || status?.flowAvailable !== true,
					onClick: () => run(() => invoke('login', device.id))
				}, t('deviceLogin')));
			} else {
				buttons.push(h('button', {
					key: 'cancel',
					type: 'button',
					style: styles.secondaryButton,
					disabled: busy,
					onClick: () => run(() => invoke('cancel'))
				}, t('cancelLogin')));
			}
			if (status?.signedIn === true) buttons.push(h('button', {
				key: 'logout',
				type: 'button',
				style: styles.dangerButton,
				disabled: busy,
				onClick: () => run(() => invoke('logout'))
			}, t('logout')));
			buttons.push(h('button', {
				key: 'refresh',
				type: 'button',
				style: styles.secondaryButton,
				disabled: busy,
				onClick: () => run(async () => {})
			}, t('refresh')));
			return h('div', { style: styles.row }, buttons);
		}

		/** 设置里的独立页：完整登录面板。 */
		function ChatGptSection() {
			const { status, failure, refresh } = useLoginStatus();
			const [localFailure, setLocalFailure] = useState(null);
			const error = localFailure ?? failure ?? status?.error ?? null;
			const models = Array.isArray(status?.models) ? status.models : [];
			return h('div', { style: styles.card }, [
				h('h3', { key: 'title', style: styles.title }, t('title')),
				h('p', { key: 'desc', style: styles.subtitle }, t('desc')),
				h(StatusLine, { key: 'status', status }),
				status?.flowAvailable === false
					? h('p', { key: 'noflow', style: styles.error }, t('noflow'))
					: null,
				h(LoginActions, { key: 'actions', status, refresh, onError: setLocalFailure }),
				h(PromptBox, { key: 'prompt', prompt: status?.prompt ?? null, refresh, onError: setLocalFailure }),
				h(Notices, { key: 'notices', notices: status?.notices ?? [], signedIn: status?.signedIn === true }),
				error === null ? null : h('p', { key: 'error', style: styles.error }, error),
				h(QuotaSummary, { key: 'quota' }),
				models.length === 0 ? null : h('div', { key: 'models' }, [
					h('p', { key: 'label', style: styles.subtitle }, t('modelsLabel')),
					h('div', { key: 'chips', style: styles.chips }, models.map((id) => h('span', { key: id, style: styles.chip }, id)))
				])
			]);
		}

		/** 模型页里 openai-codex 卡片上的内联入口。 */
		function ProviderCardExtras(props) {
			const provider = props.provider ?? {};
			if (provider.provider !== PROVIDER) return null;
			return h(ProviderCardBody, {});
		}

		function ProviderCardBody() {
			const { status, failure, refresh } = useLoginStatus();
			const [localFailure, setLocalFailure] = useState(null);
			const error = localFailure ?? failure ?? status?.error ?? null;
			return h('div', { style: styles.inline }, [
				h(StatusLine, { key: 'status', status }),
				h(LoginActions, { key: 'actions', status, refresh, onError: setLocalFailure }),
				h(PromptBox, { key: 'prompt', prompt: status?.prompt ?? null, refresh, onError: setLocalFailure }),
				h(Notices, { key: 'notices', notices: status?.notices ?? [], signedIn: status?.signedIn === true }),
				error === null ? null : h('p', { key: 'error', style: styles.error }, error)
			]);
		}

		return {
			inject: ['slots', 'remote'],
			async apply(ctx) {
				invoke = async (method, ...args) => {
					// 这个命名空间是本插件自己挂载的：写进 inject 会等自己而死锁，
					// 用 ctx.remote.<ns> 属性访问又会被 Cordis 要求 inject，
					// 所以按规范用 ctx.get() 取。
					const service = ctx.get(`remote.${NAMESPACE}`);
					if (service === undefined) throw new Error(t('remoteMissing'));
					const result = await service[method](...args);
					if (result !== undefined && result.ok === true) return result.value;
					throw new Error(result?.error?.message ?? t('callFailed'));
				};
				const locale = ctx.get('locale');
				if (locale !== undefined) {
					ctx.effect(() => {
						const disposeZh = locale.register(LOCALE_NS, 'zh', DICT.zh);
						const disposeEn = locale.register(LOCALE_NS, 'en', DICT.en);
						return () => {
							disposeZh();
							disposeEn();
						};
					}, 'chatgpt-login: locale dictionaries');
					translate = locale.bind(LOCALE_NS);
				}
				await ctx.remote.$mount(CONTRIBUTION);
				injectQuotaStyles();
				ctx.slots.inject('settings.section', () => ctx.slots.register({
					name: 'settings.section',
					id: 'chatgpt',
					order: 12,
					label: () => t('nav')
				}, ChatGptSection));
				ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
					name: 'settings.models.provider-card',
					key: SETTINGS_NS
				}, ProviderCardExtras));
				// 输入框下方的状态区：与自带的 tok/s、缓存命中排在同一行。
				ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
					name: 'conversation.composer.dock',
					id: 'chatgpt-quota',
					order: 1
				}, QuotaDock));
			}
		};
	}
});
