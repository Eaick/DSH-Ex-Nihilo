# DSH Ex Nihilo

**DSHEN** — a suite of plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

「DSHEN」是一组 DSH 插件，从零开始（*ex nihilo*）逐件打造。仓库按 monorepo 组织，`packages/` 下每个目录是一个可安装的 DSH bundle；`packages/dshen` 是把它们打成一包的套件。

## 插件

| 包 | 说明 |
|---|---|
| [`dshen-env-picker`](packages/dsh-env-picker) | 会话级运行环境选择器：Python / Node.js / C / C++ / Java / GDB，选择写进提示词，支持自动检测、手动增删、按语言开关 |
| [`dshen-rewind`](packages/dsh-rewind) | 回滚与回收站：逐轮文件快照（`/rewind`）、消息级「恢复代码并分叉」、归档会话可还原回收站（独立页面，按工作区折叠） |
| `dshen` | 套件 bundle：安装后自动带上并组合上述插件 |

> 后加的插件按同样结构放进 `packages/<name>/`，并在 `packages/dshen` 的 patch 与依赖里登记。

## 安装

DSH 提供两种安装入口，二者等价：

- **Web GUI → 插件 → 添加插件**，填包名 / 本地目录 / Git 地址；
- 对 agent 说：`plugin_manager` / `install_bundle`，`target` 填安装 spec。

### 从 npm（发布后）

```
dshen                套件（推荐，一次装齐）
dshen-env-picker     会话环境选择器
dshen-rewind         回滚与回收站
```

`install_bundle` 的 target 用 `包名@版本`，例如 `dshen@0.1.0`。

### 直接从 GitHub

Git 安装 spec 必须钉死 commit（这样 `updateBundle` 才能跟踪更新）：

```
git+https://github.com/Eaick/DSH-Ex-Nihilo.git#<40位commit>&path:/packages/dsh-env-picker
git+https://github.com/Eaick/DSH-Ex-Nihilo.git#<40位commit>&path:/packages/dsh-rewind
```

套件（`packages/dshen`）依赖的是 npm 版本：它从 GitHub 安装时，依赖仍需从 registry 解析；未发布前请直接装单个插件。

### 本地目录

把 `packages/<name>` 的绝对路径作为 target 即可（开发时的首选方式）。

## 开发

```bash
pnpm install
```

在本机验证：**插件 → 添加插件 → 选择本地目录** `packages/dsh-env-picker`（或对 agent 说 `plugin_manager install_bundle`，target 填这个绝对路径）。改动后重新安装该 bundle 即可让 Host/Client 加载新代码。

```bash
pnpm pack:check     # 逐个包执行 npm pack --dry-run，检查发布内容
```

## 发布

```bash
npm login
pnpm -r publish --access public --no-git-checks
```

- 先发插件包，再发 `dshen`：`workspace:*` 依赖在发布时会被替换成实际版本号。
- 版本语义：插件独立发版；套件版本跟随整套组合。
- 每个包都要带 `engines.dsh`，与目标 DSH 版本对齐（当前 `^0.2.2-rc.3`），这样版本不匹配时安装会被直接拒绝，而不是装上崩溃。

## 许可

[MIT](LICENSE)
