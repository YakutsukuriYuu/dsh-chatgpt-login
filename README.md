# dsh-chatgpt-login

这是一个 DeepSeek Harness（DSH）插件，让你用 ChatGPT/Codex 订阅登录并使用 `openai-codex` 模型对话，无需手动填写 API Key。插件也会在会话输入框下方显示 ChatGPT 订阅的 5 小时与周额度。

## 安装

本插件已在 **DSH 0.2.0** 版本下安装验证。**最推荐的方式**是在 DSH 的插件管理入口输入以下 GitHub 地址进行安装：

```text
github:YakutsukuriYuu/dsh-chatgpt-login
```

若使用命令行，可在目标 profile 中通过 GitHub 安装（将 `desktop` 换成你的 profile 名）：

```bash
dsh plugin --profile desktop add github:YakutsukuriYuu/dsh-chatgpt-login
```

更新插件时，在 DSH 插件入口重新安装该 GitHub 地址；也可在 profile 目录先移除旧版本再安装最新版：

```bash
cd ~/.dsh/profiles/desktop
pnpm remove dsh-chatgpt-login
pnpm add github:YakutsukuriYuu/dsh-chatgpt-login
```

安装或更新完成后重启 DSH；若更新涉及 Client UI，也刷新 DSH 页面。

> `desktop` 为默认 profile 示例，其他 profile 请替换为对应目录。本插件在 DSH 0.2.0 下验证。项目为社区插件，与 OpenAI 无关；用量读取依赖 Codex 客户端使用的非公开接口，可能随服务端变化。请确保你有权使用对应账号及订阅。

## 实现方式

插件分为 Host 与 Client 两部分：Host 调用 DSH 内置的 `openai-codex` OAuth 能力处理登录、凭据和额度查询；Client 在设置页、模型 Provider 卡片及会话输入区注册对应 UI。登录凭据保存在 Harness 凭据库中，由 pi-ai 管理令牌刷新；插件不另存明文令牌。

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
