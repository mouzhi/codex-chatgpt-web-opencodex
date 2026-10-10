# Codex Web GPT — OpenCodex provider edition

这是基于 [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) 的独立 OpenCodex provider fork。
用于已有 **Codex / CodexHost → OpenCodex** 的环境：Web 模型只是一个下游提供方，既有原生模型继续由 OpenCodex 管理。

当前基线：上游 **6.1.7**，包含本分支的环境识别、续聊、视口恢复、附件定位和输出留存修复。
详细的上游介绍见 [上游 README](README.upstream.md)；其中普通版安装/更新步骤不适用于本专用 profile。

## 本版保留的功能

- 独立 provider、Codex bridge home 和浏览器 profile，固定 `127.0.0.1:17841`。
- 自动 Web 模型的 900K 聚合上下文、Compatibility V1 子代理，以及历史模型 ID 兼容。
- 普通保存会话、长任务处理、最终页面留存和最终输出 JSON/Markdown 备份。
- OpenCodex 转发后丢失消息级来源标记、页面上下文隔开环境和指令时，通过当前原生任务记录校验环境。
- 可选 Zero Risk / Zero Risk Pro 手动模式，使用独立 Tunnel/连接器；手动模式仍采用上游的上下文限制。

## 源码启动（Windows / macOS）

先安装 **Bun 1.4.0**、Node.js 24 和 Git。Codex/CodexHost、OpenCodex 应已配置正常。

```sh
git clone --branch opencodex https://github.com/mouzhi/codex-chatgpt-web-opencodex.git
cd codex-chatgpt-web-opencodex
bun run launcher:opencodex
```

首次运行会安装锁定依赖、构建启动器并打开专用窗口。登录自己的 ChatGPT 账号，
在启动器中完成 Full MCP/Tunnel 配置，并按启动器显示的名称创建连接器。
已有专用 profile 的登录、模式和 Tunnel 会被沿用。

此入口始终使用 `--opencodex-provider`，不安装或覆盖原生 Codex 路由。
不要使用上游普通版的 `bun run launcher` 或普通版安装器来替代它。

仅准备构建，不打开窗口或修改机器配置：

```sh
bun run launcher:opencodex --prepare-only
```

源码启动需要保持启动器进程运行；未打包的 Electron 不提供系统开机自启。
窗口关闭后的后台行为取决于启动器设置。Windows 可构建独立安装包：

```sh
bun run --cwd launcher package:win:opencodex
```

## 添加 OpenCodex 提供方

按 [模板](examples/opencodex-provider.json) 添加 `codex-with-chatgpt` 提供方：

| 项目 | 值 |
|---|---|
| Adapter | `openai-responses` |
| Base URL | `http://127.0.0.1:17841/v1` |
| Auth mode | `local`，无需 API key |
| Allow private network | `true`，仅此 loopback 提供方 |
| Live models | `false` |
| Automatic context window | `900000` |

模板是一个 provider 对象，不是完整的 OpenCodex 配置。请合并到既有配置，勿覆盖整个配置文件。
新用户只需启用账号支持的四个新模型条目；旧的 Light/Medium/High/Extra High/Pro 仅用于旧任务兼容。
具体操作与模式切换见 [运行说明](docs/opencodex-provider.md)。

## 每位使用者自己的配置

源码和安装包不包含任何登录、cookie、API key 或 Tunnel ID。
每位使用者配置自己的账号、Tunnel、runtime key 和连接器；不要拷贝他人的 provider home 或浏览器 profile。
自动/手动模式的 Tunnel 应分开，多个连接器共用账号时使用不同名称。

本地状态保存于用户目录下的 `.codex-chatgpt-web-opencodex` 和 `.codex-opencodex-web-bridge`。
自动模式最终输出在 `logs/final-outputs`；这些内容也不应提交到 Git。

这是非官方 ChatGPT Web 桥接。网页、模型菜单或连接器变化仍可能需要适配。
Zero Risk 是手动交互模式名称，不是账号不会受到限制的保证。

## 维护和同步

`opencodex` 是本 fork 的默认维护分支，`main` 保持上游分支身份。
每次合并上游版本、通过测试后，将专用提交推送到 `opencodex`，并打独立快照标签。
不要用 GitHub 的覆盖同步操作替代合并，否则会丢失专用修改。

完整步骤见 [上游同步规范](docs/opencodex-upstream-sync.md)。本项目保留上游 MIT License 和署名。
