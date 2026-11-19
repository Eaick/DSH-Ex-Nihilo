# dshen（套件）

**DSHEN** — DSH Ex Nihilo 插件套件：装这一个包，就把整套组合里的插件一起带上，并按 `cordis.patch.yml` 挂进 profile。

| 包含的插件 | 说明 |
|---|---|
| [`dshen-env-picker`](../dsh-env-picker) | 会话级运行环境选择器（Python / Node.js / C / C++ / Java / GDB） |
| [`dshen-rewind`](../dsh-rewind) | 回滚与回收站：逐轮文件快照、消息级「恢复代码并分叉」、归档会话回收站页面 |

## 安装

本包暂时**不能单独安装**：它的依赖是 `workspace:*`，需要先在本仓库执行 `pnpm install`，再由 profile 从仓库里引用。对外发布后再补安装说明。

想在 DSH 里用这套组合，请先分别装两个插件（见[根 README](https://github.com/Eaick/DSH-Ex-Nihilo#安装)）。

## 维护

套件本身没有运行时代码，`index.js` 只是空入口，价值全在 patch 与依赖。加新插件时：

1. `package.json` 的 `dependencies` 加 `"<pkg>": "workspace:*"`；
2. `cordis.patch.yml` 追加 `- id: <row-id>` / `name: '<pkg>'`。

## 许可

[MIT](LICENSE)
