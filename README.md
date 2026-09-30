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

### 安装（从 GitHub 获取）

建议使用 DSH CLI 安装，这样 DSH 会把 bundle 登记到 profile：

```bash
dsh plugin --profile desktop add github:YakutsukuriYuu/dsh-chatgpt-login
```

将 `desktop` 替换为你的 profile 名。也可以直接使用 pnpm，但要在该 profile 目录中执行：

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:YakutsukuriYuu/dsh-chatgpt-login
```

安装后确认 `dsh-chatgpt-login` 已加入该 profile 的 bundle 列表，然后重启 DSH。之后到 **设置 → ChatGPT 订阅** 完成登录。

### 更新插件

作者推送新版本后，推荐在同一 profile 重新安装 GitHub 版本：

```bash
dsh plugin --profile desktop remove dsh-chatgpt-login
dsh plugin --profile desktop add github:YakutsukuriYuu/dsh-chatgpt-login
```

如果你的环境没有 `dsh` 命令，也可在 profile 目录使用 pnpm：

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-chatgpt-login
pnpm add github:YakutsukuriYuu/dsh-chatgpt-login
```

这里采用“移除再添加”，确保重新获取 GitHub 上的最新提交，而不是继续使用 lockfile 固定的旧提交。完成后重启 DSH，使 Host 代码重新加载；如果更新涉及 Client UI，也刷新 DSH 页面。

> `desktop` 是 profile 名示例；若使用其他 profile，请替换为其实际目录。首次从 GitHub 安装前，请先审阅并信任仓库代码。该插件是纯 JavaScript，目前无需构建步骤。

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

## 项目开发

本仓库面向用户安装和使用；开发者可在本地克隆仓库、修改源码并提交 Pull Request。发布更新后，用户按上方“更新插件”步骤重新从 GitHub 安装。

## 项目文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 服务：登录状态、OAuth 登录、退出和额度读取 |
| `quota.js` | 查询额度接口并在需要时刷新令牌 |
| `client.js` | 设置页、模型登录入口和会话额度显示 |
| `cordis.patch.yml` | 声明插件 bundle |
| `package.json` | 插件元数据与 DSH Client 注入配置 |
