# 维护者指南

本文件只写**开发和发布**；安装与使用见 [README.md](README.md)。

## 目录结构

```
.
├─ packages/
│  ├─ dsh-env-picker/     包名 dshen-env-picker
│  ├─ dsh-rewind/         包名 dshen-rewind
│  └─ dshen/              套件包（只聚合上面两个）
├─ pnpm-workspace.yaml
└─ package.json           私有根，只放脚本
```

目录名沿用旧习惯（`dsh-*`），**包名**统一 `dshen-*`；两者不一致是有意的，不要"顺手改目录名"。

## 开发

```bash
pnpm install
```

安装到本机 DSH 验证：

- Web GUI：**插件 → 添加插件**，填 `packages/<包目录>` 的绝对路径；
- 或者对 agent 说 `install_bundle`，`target` 填同一个绝对路径。

改完代码需要**重新安装该 bundle**（或重新选一次目录）才会重新加载 Host/Client。

## 测试

```bash
# 环境选择器（Host 逻辑）
node packages/dsh-env-picker/test/smoke.mjs

# 回滚 + 回收站（105 个用例）
cd packages/dsh-rewind && npm test
```

发布前再跑一次打包检查：

```bash
pnpm pack:check        # 对每个包执行 npm pack --dry-run
```

## 发布到 npm

```bash
npm login
pnpm -r publish --access public --no-git-checks
```

- **先插件、后套件**：`dshen` 用 `workspace:*` 依赖，pnpm 在发布时会把它替换成实际版本号；顺序反了会发出版本解析不到的套件。
- 插件独立发版，套件版本跟整套组合走。
- 每个包都必须有 `engines.dsh`，它的作用是把"版本不匹配"挡在安装阶段。
- 包的 `files` 里要包含 `LICENSE`；`README.md` 会被 npm 页面自动读取。

## 改包名时同步三处

包名出现在三个地方，漏一处就会出现「Host 正常、界面消失」的假故障：

1. `package.json` 的 `name`；
2. `cordis.patch.yml` 里 `name: '<包名>'`；
3. `client.js` 开头的 `window.__ModuleLoader__.load({ id: '<包名>', ... })`——浏览器端按这个 id 找模块，与包名不一致时客户端那一半根本不注册（环境按钮、回收站图标这类 UI 会消失，而 Host 侧工具/提示词仍然工作）。

改完后重新安装并刷新页面验证：`conversation.input.left` 里应能看到 `env-picker-trigger`，`sidebar.panellist` 里应能看到 `dsh-rewind-trash`。

## Git 安装 spec

DSH 的安装目标除了包名和本地目录，还接受 pnpm 的 git 依赖写法：

```
git+https://<host>/<owner>/<repo>.git#<40位commit>&path:/packages/<目录>
```

- commit 必须完整 40 位；短 sha、分支名、tag 都不行；
- `path:` 指到**包含 package.json 的目录**；
- 公开仓库不需要凭据；私有仓库走本机 git 凭据；
- 这种装法钉死 commit，`updateBundle` 不会跟踪，升级 = 换 commit 重装。

## 文档分工

| 文件 | 读者 | 写什么 |
|---|---|---|
| 根 `README.md` | 安装者 | 这是什么、怎么装、装完看到什么 |
| `packages/*/README.md` | 安装者 | 单个插件的功能、用法、限制 |
| `CONTRIBUTING.md` | 维护者 | 开发、测试、发布、命名规则 |

发布物里不要出现：真机窗口截图、本机绝对路径、个人邮箱。截图只放组件渲染图或通用示例路径（`C:\Python311`、`C:\mingw64` 这类）。
