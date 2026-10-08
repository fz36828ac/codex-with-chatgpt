# 本地部署与校验

本地模式使用 `127.0.0.1`，不会启动公网隧道或连接 ChatGPT 账号。它可以验证真实后台进程、OAuth 和 MCP 服务；不等于已完成 ChatGPT 网页连接。

在 checkout 中安装锁定依赖并构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
```

在尚未配对、未启用公网隧道的本项目工作区执行真实服务校验：

```sh
pnpm test:local --keep-running --report /absolute/path/local-deployment-check.json
```

校验包括后台启动、只监听回环地址（macOS）、未授权拒绝、实际 OAuth 配对与 PKCE、10 个只读工具、文件访问限制、分页、scope 隔离、重启后的令牌恢复、刷新令牌轮换、状态文件权限和撤销。测试凭据会撤销，临时文件会删除；报告不保存令牌或配对码。

默认目标是 checkout 本身，`--workspace <path>` 可以指定另一个尚未配对的 C2C 项目工作区。该脚本会重启目标服务，因此拒绝已授权或启用公网隧道的工作区。省略 `--keep-running` 时，会停止由本次校验新启动的后台服务。

日常启动、查看状态和停止：

```sh
node bin/c2c.js start -w /absolute/path/workspace --json
node bin/c2c.js status -w /absolute/path/workspace --json
node bin/c2c.js stop -w /absolute/path/workspace
```

凭据和运行状态使用系统应用目录，macOS 为 `~/Library/Application Support/codex-with-chatgpt`，不会放在仓库里。后台服务不是系统登录启动项：停止进程或重启机器后需要重新启动。

自动更新检查跟随 checkout 的 Git 跟踪分支；未设置跟踪时检查 origin 上的同名分支。固定提交的 detached checkout 不自动检查更新，避免把 fork 的旧默认分支误报为更新。缓存与当前分支、当前提交绑定。

后续连接 ChatGPT 网页仍需要公网可达的受保护连接、ChatGPT 登录及连接器权限。这些不属于上述本地校验的通过范围。
