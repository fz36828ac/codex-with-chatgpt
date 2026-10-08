# 类似项目实现对比

检查日期：2026-10-08。范围为公开 README 和相关源码的只读检查，未运行这些项目、未登录账号验证，也未对它们进行完整安全审计。以下结论区分实际代码、项目声明与建议；不以星数代表可靠性。

## 结论

当前 C2C 的定位仍适合“ChatGPT 规划和审查，Codex 执行”：服务只提供工作区读取，没有远程写文件或执行命令工具。本次修复保留这一边界。

RepoRelay 的文件访问实现最值得参考：将 Git 元数据列为禁止访问路径、在打开文件后核对文件身份，并拒绝链接。RPG-478 的实现展示了不建立远程文件连接器的代问路线，但需要把选定上下文发给 ChatGPT，并维护浏览器登录态。Liao330 增加稳定中继和恢复机制，代价是额外部署。Dalomeve 提供本地写入和执行能力，权限边界与只读 C2C 不同，不能直接作为安全替代品。

## 对比

| 项目 | 工作方式 | 连接与环境 | 权限与限制 | 可借鉴内容 |
| --- | --- | --- | --- | --- |
| [Lukie-81/RepoRelay](https://github.com/Lukie-81/RepoRelay) | ChatGPT 读取一个批准的仓库；只读模式 4 个工具，默认另有 3 个固定交接文件写入工具 | 项目使用 OpenAI Secure MCP Tunnel / tunnel-client；其安装说明要求隧道标识、运行凭据和相应账户权限 | 无 Shell、Git 和任意路径写入；拒绝 `.git`、符号链接、junction、硬链接；读取前后核对路径和文件身份，文件读取上限 1 MiB | 文件身份复核、独立安全自检、固定交接目标；更强的链接策略会限制合法工作区链接 |
| [RPG-478/codex-chatgpt-bridge](https://github.com/RPG-478/codex-chatgpt-bridge) | Codex 通过本地 CLI/MCP 生成简短问题包，手工或 Playwright 向 ChatGPT 网页代问并解析回答 | 持久浏览器 profile、ChatGPT 登录；所读实现不通过远程工作区 MCP 文件连接器传输上下文 | 发出/保存问题前用规则检测高置信度凭据；校验 Project URL、响应格式；秘密检测不是完整数据分类 | 紧凑委派、发送前秘密检查、明确响应结构；浏览器界面和登录态仍是运行依赖 |
| [Liao330/codex-chatgpt-bridge](https://github.com/Liao330/codex-chatgpt-bridge) | 基于 vendored C2C 数据平面，加上治理回执、会话身份和恢复约束 | 部署说明采用 Tailscale Funnel 中继 + SSH 反向隧道，并提供 Windows 启动监督脚本 | 延续只读数据平面和 OAuth；控制消息限制；丢失身份时标记 unknown，不静默重复任务 | 稳定地址、监督进程、任务身份恢复；增加 Tailscale、SSH、中继机器和部署维护依赖 |
| [Dalomeve/codex-chatgpt-bridge](https://github.com/Dalomeve/codex-chatgpt-bridge) | ChatGPT 调用本地文件和 Codex 委派/会话工具 | Python 服务、Codex、本地端点或稳定 HTTPS 隧道；支持 bearer 和 secret URL 两种入口 | 路径授权区分读、写、执行；默认 full 工具配置可包含写入和 Codex 任务，delegate 配置收窄可见工具但仍可委派执行 | 分开的路径授权、连接诊断、工具配置；secret URL 本身必须当作凭据保护，执行能力需要不同的信任模型 |

## 源码证据和固定版本

1. RepoRelay，提交 `2ef96b712b9efa6be59ecfbcb9c8941b45d9a113`：
   - [路径禁止列表、1 MiB 限制、打开后文件身份检查](https://github.com/Lukie-81/RepoRelay/blob/2ef96b712b9efa6be59ecfbcb9c8941b45d9a113/src/review-files.ts)
   - [模式、工具和隧道配置说明](https://github.com/Lukie-81/RepoRelay/blob/2ef96b712b9efa6be59ecfbcb9c8941b45d9a113/README.md)
2. RPG-478，提交 `cb0e18a1038e625e966b2b94099e3b313e4a292e`：
   - [浏览器适配器](https://github.com/RPG-478/codex-chatgpt-bridge/blob/cb0e18a1038e625e966b2b94099e3b313e4a292e/src/adapters/playwright.ts)
   - [发送前秘密检测](https://github.com/RPG-478/codex-chatgpt-bridge/blob/cb0e18a1038e625e966b2b94099e3b313e4a292e/src/redaction.ts)
   - [问题包生成](https://github.com/RPG-478/codex-chatgpt-bridge/blob/cb0e18a1038e625e966b2b94099e3b313e4a292e/src/prompt.ts)
3. Liao330，提交 `4257e1cd7be0d835bca83680870ff8825e45f8a3`：
   - [部署和恢复说明](https://github.com/Liao330/codex-chatgpt-bridge/blob/4257e1cd7be0d835bca83680870ff8825e45f8a3/README.md)
   - [上游复用记录](https://github.com/Liao330/codex-chatgpt-bridge/blob/4257e1cd7be0d835bca83680870ff8825e45f8a3/UPSTREAM.md)
4. Dalomeve，提交 `c022afddcc3dea588a14136df571263a2d36000f`：
   - [身份验证入口与工具暴露](https://github.com/Dalomeve/codex-chatgpt-bridge/blob/c022afddcc3dea588a14136df571263a2d36000f/src/codex_chatgpt_bridge/mcp.py)
   - [路径和敏感文件识别](https://github.com/Dalomeve/codex-chatgpt-bridge/blob/c022afddcc3dea588a14136df571263a2d36000f/src/codex_chatgpt_bridge/security.py)

## 对本 fork 的建议

已实现：禁止 `.git` 目录及 worktree 指针文件的直接读取和搜索；保持 UTF-8 响应字节上限；对单页无法完整返回的首行给出明确错误；增加 16 MiB 文本扫描上限和增长保护；更新依赖并加入回归测试。

后续可以独立评估打开文件后的身份复核、更加严格的链接策略，以及稳定隧道提供器。它们涉及兼容性、账号权限或部署变化，本次未直接移植。

修复与依赖更新不会消除外部网络依赖：当前 fork 仍需要 ChatGPT 网页和 Cloudflare 隧道。真实登录、配对、代理网络及重启后连接恢复仍需端到端验证。
