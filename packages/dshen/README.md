# dshen（套件）

**DSHEN** — DSH Ex Nihilo 插件套件：装这一个包，就把整套组合里的插件一起带上，并按 `cordis.patch.yml` 挂进 profile。

| 包含的插件 | 说明 |
|---|---|
| [`dshen-env-picker`](../dsh-env-picker) | 会话级运行环境选择器（Python / Node.js / C / C++ / Java / GDB） |
| [`dshen-rewind`](../dsh-rewind) | 回滚与回收站：逐轮文件快照、消息级「恢复代码并分叉」、归档会话回收站页面 |

## 安装

**只支持两种方式：**

- **npm**（发布后）：在「插件 → 添加插件」填 `dshen`，或 `install_bundle` target 填 `dshen@0.1.0`；
- **本地目录**（开发时）：选 `packages/dshen` 这个目录（需先在本仓库执行 `pnpm install`，让 `workspace:*` 链接生效）。

**不能**用 Git 地址安装本包：它的依赖写成 `workspace:*`，需要 registry 才能解析；想从 GitHub 装请直接装上面两个插件（见[根 README](https://github.com/Eaick/DSH-Ex-Nihilo#安装)）。

## 维护

套件本身没有运行时代码，`index.js` 只是空入口，价值全在 patch 与依赖。加新插件时：

1. `package.json` 的 `dependencies` 加 `"<pkg>": "workspace:*"`；
2. `cordis.patch.yml` 追加 `- id: <row-id>` / `name: '<pkg>'`；
3. 发布顺序：先发插件、再发套件。

## 许可

[MIT](LICENSE)
