# 维护者指南

本文件只写**开发和发布**；安装与使用见 [README.md](README.md)。

## 目录结构

```
.
├─ packages/
│  ├─ dsh-env-picker/     包名 dshen-env-picker
│  ├─ dsh-rewind/         包名 dshen-rewind
│  └─ dshen/              套件包（暂时只能本地开发用）
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
cd packages/dsh-rewind && node test/run-tests.mjs
```

打包检查（确认每个包里该有的文件都在）：

```bash
pnpm pack:check        # 对每个包执行 npm pack --dry-run
```

## 改包名时同步三处

包名出现在三个地方，漏一处就会出现「Host 正常、界面消失」的假故障：

1. `package.json` 的 `name`；
2. `cordis.patch.yml` 里 `name: '<包名>'`；
3. `client.js` 开头的 `window.__ModuleLoader__.load({ id: '<包名>', ... })`——浏览器端按这个 id 找模块，与包名不一致时客户端那一半根本不注册（环境按钮、回收站图标这类 UI 会消失，而 Host 侧工具/提示词仍然工作）。

改完后重新安装并刷新页面验证：`conversation.input.left` 里应能看到 `env-picker-trigger`，`sidebar.panellist` 里应能看到 `dsh-rewind-trash`。

## 文档分工

| 文件 | 读者 | 写什么 |
|---|---|---|
| 根 `README.md` | 安装者 | 这是什么、怎么装、装完看到什么 |
| `packages/*/README.md` | 安装者 | 单个插件的功能、用法、限制 |
| `CONTRIBUTING.md` | 维护者 | 开发、测试、命名规则 |

发布物里不要出现：真机窗口截图、本机绝对路径、个人邮箱。截图只放组件渲染图或通用示例路径（`C:\Python311`、`C:\mingw64` 这类）。
