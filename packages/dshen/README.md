# dshen

**DSHEN** — the DSH Ex Nihilo plugin suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

安装这个 bundle 会把整套组合里的插件一起装好，并按 `cordis.patch.yml` 把它们挂进 profile：

| 插件 | 说明 |
|---|---|
| [`dshen-env-picker`](../dsh-env-picker) | 会话级运行环境选择器（Python / Node.js / C / C++ / Java / GDB） |
| [`dshen-rewind`](../dsh-rewind) | 回滚与回收站：逐轮文件快照、消息级「恢复代码并分叉」、归档会话回收站页面 |

## 安装

在 Web GUI 里：**插件 → 添加插件**，填 `dshen`（发布后）或本地目录 `packages/dshen`（开发时）。

也可以对 agent 说：`plugin_manager` / `install_bundle`，target 填 `dshen@0.1.0` 或该目录的绝对路径。

## 开发

套件用 workspace 依赖指向同仓库插件，发布时 pnpm 会把 `workspace:*` 换成实际版本号。加新插件时：

1. 在 `package.json` 的 `dependencies` 里加 `"<pkg>": "workspace:*"`；
2. 在 `cordis.patch.yml` 里追加一条 `- id: <row-id>` / `name: '<pkg>'`。

## 许可

[MIT](LICENSE)
