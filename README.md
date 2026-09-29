# dsh-chatgpt-login

**在 DeepSeek Harness（DSH）中使用 ChatGPT/Codex 订阅登录，并查看 5 小时与周用量。**

在 **设置 → ChatGPT 订阅** 中完成 OAuth 登录后，可以选择 DSH 模型页提供的 `openai-codex` 模型对话，无需手动填写 API Key。插件还会在会话输入框下方显示订阅额度。

> 本项目为社区插件，与 OpenAI 无关。用量读取使用 Codex 客户端调用的非公开接口；接口可能变更，插件不保证持续可用。请确认你有权使用对应的 ChatGPT/Codex 账号及订阅。

## 它做什么

- **Host 半边**：把内置的 `openai-codex` 授权流（由 `@deepseek-ai/dsh-llm-pi-ai` 注册）包成一个可从设置页调用的服务，驱动 OAuth 登录、转发授权链接/设备码/提问、读写登录态；并用同一份凭据去问官方用量接口，读出两个额度窗口。
- **Client 半边**：在设置里加一页「ChatGPT 订阅」，在 **设置 → 模型** 的 `openai-codex` provider 卡片上内联一个登录入口，并在输入框下方的状态区加一个额度胶囊。

登录成功后，token 存在 Harness 凭据库里（记录键 `llm-pi-ai/openai-codex`），由 pi-ai 按订阅额度自动刷新，设置页会显示账号与过期时间。

## 额度显示

输入框下方那排（平时显示 tok/s、缓存命中）会多出一个胶囊：

```
● 5小时 94% · 周 76%
```

- **数字是剩余额度**，颜色随最紧张的那个窗口变化：> 40% 绿、15%–40% 黄、≤ 15% 红（进度条与数字同色）。
- **鼠标悬停**（或键盘聚焦）展开明细，卡片固定 320px 宽，每个窗口两行：

  ```
  ChatGPT 订阅额度                 套餐 Plus
  5小时  [███████████████████░]  剩余 99%
         4 小时 39 分后重置 · 明天 01:18
  周     [████████████░░░░░░░░]  剩余 59%
         5 天 3 小时后重置 · 10月5日 00:38
  更新于 20:38                              刷新
  ```

- **点击**胶囊会固定住明细并强制刷新一次；每 5 分钟后台自动刷新一次，Host 侧另有 60 秒缓存避免重复请求。
- 没登录 ChatGPT 时这个胶囊不渲染；读取失败时显示「额度不可用」，明细里给出原因。

数据来自 Codex 客户端自己用的官方接口：

```
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>
```

返回的 `rate_limit.primary_window` 是 5 小时滚动窗口、`secondary_window` 是 7 天窗口（`used_percent` 为已用百分比）。
`access_token` 是短命 JWT，401/403 时用 `refresh_token` 换新令牌后重试；刷新走 `credentials.modifyRecord`，
把「读旧凭据 → 换令牌 → 写回」放进同一把写锁，不会和 pi-ai 自己的刷新互相覆盖。

## 安装

### 从本地目录加载

此仓库是 DSH bundle 插件项目。对于支持从本地 bundle 加载的 DSH 配置，可将仓库放入该 profile 的 `node_modules`，并确保插件目录名为 `dsh-chatgpt-login`。开发时也可以使用符号链接，让 DSH 加载工作区中的源码：

```bash
# 在 DSH desktop profile 的 node_modules 目录下执行
ln -s /绝对路径/dsh-chatgpt-login dsh-chatgpt-login
```

然后在 DSH 插件管理中启用 `dsh-chatgpt-login`；如果当前版本/配置不支持本地 bundle 加载，请按 DSH 的 bundle 安装流程将项目加入 profile。源码修改后需重启 DSH 使 Host 代码重新加载，Client UI 修改后刷新页面。

> 该项目的 `package.json` 声明了 bundle patch 和 Web client 注入目标。安装目录因 DSH profile 而异；`~/.dsh/profiles/desktop/node_modules/` 是 desktop profile 的常见位置。

## 用法

1. 设置 → **ChatGPT 订阅** → 点「登录 ChatGPT」
2. 选登录方式：
   - **Browser login**：点出现的授权链接（或自动打开），在浏览器里用 ChatGPT 账号登录授权；本机 1455 端口接收回调。
   - **Device code login**：把界面给出的验证码填到 `https://auth.openai.com/codex/device`，适合没有浏览器回调的机器。
3. 状态变成「已登录 ChatGPT」后，到 **设置 → 模型** 选 `gpt-6-astra` / `gpt-6-luna` / `gpt-6-sol` 等模型即可。
4. 开始对话后，输入框下方就会出现额度胶囊。

## 前置条件

- 已启用 `@deepseek-ai/dsh-llm-pi-ai`（它提供 `openai-codex` 的 OAuth 流与模型目录）。
- 模型页里已添加 `openai-codex` provider；缺了的话这一页登录本身能用，但没有模型可选。
- `auth.openai.com` 与 `chatgpt.com` 网络可达（需要系统级代理/TUN，或在 `~/.dsh/.env` 里给 Host 配 `HTTPS_PROXY`）。

## 实现要点

- **只依赖相对路径**：外部安装的 bundle 解析不到 `@deepseek-ai/*` 裸包名，所以 Host 半边只 import 同目录的 `quota.js`，服务用 `ctx.provide` 注册。
- **手写 Remote 标记**：没有构建步骤就用不了 Typert 装饰器，于是在 `ChatGptLogin.prototype` 上直接写 `@deepseek-ai/dsh-typert-protocol/remote-methods` 描述符；Client 半边用 `ctx.remote.$mount({ package, descriptors })` 挂上对应命名空间，之后调 `ctx.remote.chatgptLogin.*`。
- **额度胶囊挂在 `conversation.composer.dock`**：这是会话内的列表槽，用一个自己的 id（`chatgpt-quota`）注册就会与自带条目并排，不会替换掉 tok/s 那一格。
- **改动 Host/Client 代码后需要重启 DSH**：禁用再启用插件不会重新 import 模块（同一 specifier 命中 ESM 缓存）。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半边：`status` / `login` / `cancel` / `answer` / `logout` / `quota` |
| `quota.js` | Host 半边：官方用量接口与令牌刷新（`fetchCodexQuota` / `refreshCodexToken`） |
| `client.js` | Client 半边：`settings.section` 页面 + `settings.models.provider-card` 内联入口 + `conversation.composer.dock` 额度胶囊 |
| `cordis.patch.yml` | 插入 `chatgpt-login` 行 |
| `package.json` | bundle + `dsh.client` 声明 |
