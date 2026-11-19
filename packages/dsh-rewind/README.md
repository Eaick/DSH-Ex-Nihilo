# dsh-rewind（回滚与回收站）

逐轮文件快照（`/rewind`）＋ 会话可还原回收站。两组能力共用一个存储根目录。

- **回滚（rewind）**：文件工具每次改动**之前**先记录内容，每轮落一个 checkpoint，需要时原样写回。对话部分用**分叉**实现——在目标轮边界新建会话，原会话从不被改写。
- **回收站（trash）**：归档的会话直接出现在回收站页面，可还原或彻底删除；`/trash <id>` 还能把某个会话的日志与快照整体移入回收站副本，再搬回来。

## 命令

| 命令 | 含义 |
|---|---|
| `/rewind` | 列出本会话的 checkpoint（轮次、时间、文件数、文件名）。 |
| `/rewind <turn>` | 把文件还原到第 `<turn>` 轮开始之前。 |
| `/rewind all` | 还原到第一条记录之前。 |
| `/rewind diff` | 只对比最新 checkpoint 与当前文件，不写盘。 |
| `/trash-list` | 列出回收站条目。 |
| `/trash <sessionId>` | 归档该会话并移入回收站；若日志已不在而侧栏仍显示，则改为摘掉那一行。 |
| `/trash-restore <id>` | 还原：搬回日志与快照、取消归档、挂回原工作区。 |
| `/trash-purge <id>` | 永久删除副本，**同时**把该会话从工作区摘除。 |
| `/trash-prune` | 清理「日志已丢失但侧栏还在显示」的失效条目。 |
| `/rewind-message <messageId> <mode>` | 消息级回滚菜单的宿主端；`mode` = `code` / `fork` / `fork-code`。 |

还原是幂等的：内容与快照一致就跳过；参数既不是数字也不是 `all` 时 `/rewind` 会拒绝猜测。

## 回收站页面

回收站是一个独立页面，不是弹窗：

- 侧栏面板列表（Plugins、Schedules 旁）多一行 **回收站**，点开在主栏整页渲染。
- **归档即入口**：本版 DSH 的「归档会话」不会隐藏会话，而是原地变灰。所以页面直接列出**日志仍在原位**的归档会话：还原 = 取消归档（行恢复正常），彻底删除 = 删日志。不需要第二个「删除」动作。
- **删除会连带清掉投影缓存行**：侧栏单靠 `session_projcache` 缓存也能画出灰行，留着它就是"删了还看得见"的根源。
- 一个列表容纳两类条目：**归档**行（日志在 → 还原 = 取消归档，彻底删除 = 删日志）与 **副本**行（`/trash` 移入 → 还原 = 搬回并重新挂载）。
- 页面沿用 DSH 的页面外壳：**居中 960px 内容列**＋ 两侧自适应内边距，标题 20px/500、说明 13px，和「插件」页对齐；标题区与搜索框固定，列表在自身细滚动条下滚动。
- **按工作区折叠**：条目按工作区路径分组，每组一个可折叠的组头（箭头 + 工作区名 + 条目数 + 完整路径），多组时右上出现「折叠全部 / 展开全部」；搜索时自动展开匹配组。
- **搜索会话**按标题、会话 id、工作区路径过滤（纯前端、即输即筛、`Esc` 清空）。
- 每行显示会话**标题**，然后是 id · 时间 · 工作区路径；`运行中` 标签表示本进程仍持有该会话（回合结束前不允许删除）。
- 每行以**扁平样式**呈现（悬停才出底色，无边框卡片），右侧是 已归档/已删除 徽章与 还原 / 彻底删除（二次点击确认）两个文字按钮；页脚「清空回收站」现在**同时清副本与归档会话**，正在运行的会话会跳过并在结果里说明数量。
- 当某个工作区仍登记着日志已丢失的会话时，页面顶部给出提示和「清理失效条目」按钮——这种行留在侧栏也打不开。

实现上就是一个 `main` 面板（`key: dsh-rewind-trash`）加一条同 id 的 `sidebar.panellist` 入口，因此任何地方都能 `ctx.layout.selectPanel('dsh-rewind-trash')` 打开。

页面通过共享 API fetch 通道（`ctx.connection.fetch`）读写 `GET`/`POST /api/dsh-rewind/trash`，只有已认证的浏览器 Peer 能访问；刷新不会往任何会话日志里写命令记录。返回体带版本号（`version: 1`）、只含客户端安全字段，副本的绝对路径不会过网线。动作：`restore` / `purge` / `purge-all` / `prune-ghosts` / `discard` / `unarchive` / `purge-in-place`。

## 模型工具

| 工具 | 动作 |
|---|---|
| `rewind` | `list` 列 checkpoint、`diff` 对比某一轮的还原计划、`restore` 还原文件。 |
| `trash` | `list` 列条目、`restore` 还原一个、`purge` 永久删除一个、`prune` 清理失效侧栏行、`forget` 只摘账号与缓存（不动文件）。 |

界面动作与工具调用同一套宿主能力（`ctx.rewind.*`、`ctx.trash.*`）。

## 记录范围

- 所有 `fs/write-intent`、`fs/edit-intent`、`fs/delete-intent` 变更，在真正执行**之前**经组合文件系统捕获；覆盖 `write`、`edit`、`apply_patch` 这类文件工具。
- 只记录带工作目录的会话的顶层轮次，子代理会话不记录。
- 只处理 `maxFileBytes` 以内的文本文件，其余列为跳过且不触碰。
- **Git 轮次**：工作目录位于 git 仓库时，轮次开始会把整个工作树（遵守 `.gitignore`）写成 git tree 存入会话私有对象库。`/rewind` 因此还能还原被 `bash`、脚本改过的文件：只重写树里存在的路径，轮次之后新建的文件不会被删，比 `git reset --hard` 严格更窄，且不动仓库 index。仅当会话沙箱策略本来就允许写这些路径时才运行（`danger-full-access`，或仓库位于会话工作目录内）。

不记录、因而不可还原：其他进程或会话的改动、目录的创建与删除、符号链接与硬链接（还原时跳过）、以及插件安装之前已经发生的轮次。

## 回收站语义

- `discard` **先归档**再搬文件；后续任一步失败都会反向回滚并取消归档，不会把会话留在半路。同时记下工作区路径，还原时才能把侧栏行放回去。
- `restore` 搬回会话日志与快照、取消归档、并（尽力）挂回原工作区；挂回被拒也会完成文件还原并记日志。
- `purge` 先摘**工作区账号**再删副本：让已删除会话"复活"的正是侧栏那一行，只取消归档只会让它重新可见。账号写失败则保留副本、可重试；文件删失败则该条目仍列在回收站里、行已消失。
- `prune`（页面按钮、`/trash-prune`、`trash prune`）摘掉「日志已不存在且不在回收站」的侧栏行；这类行来自插件之外的删除，或更早版本的 purge。
- ⚠️ **在本进程打开过的会话，彻底删除后要重启 App 才会从侧栏完全消失。** 日志、投影缓存、账号都会立刻清掉，但 DSH 的侧栏列表包含进程内 live agent，而 DSH 没有卸载 agent 的 API，归档态又是原地灰行，所以那一行只能等进程结束。**没在本进程打开过的会话，删除后立即消失。** `purge` 会先把行藏起来（归档）并把 id 记进 `<storageDir>/parked.json`，在下次激活、下次读取回收站页面、或 agent 释放时摘掉账号。
- `prune` 会跳过本进程仍持有 agent 的失效条目并如实说明；后续由上面的 parked 清扫收尾。
- `purge` 只删回收站副本，从不触碰仍在使用的会话。

## 配置

```yaml
- id: rewind
  name: 'dsh-rewind'
  config:
    storageDir: 'C:\\Users\\you\\.dsh\\rewind'  # 默认 $DSH_HOME/rewind
    maxFileBytes: 2097152                       # 单文件快照上限 2 MiB
    maxCheckpoints: 100                         # 每会话保留的最新记录数
    retentionDays: 30                           # 超期记录会被清理
    gitSnapshots: true                          # 仓库内每轮写一棵 git tree
    gitTimeoutMs: 30000                         # 单条 git 命令超时
```

每个会话**最旧的一条 checkpoint 永远保留**，保证全量回滚有底线。清理记录时，不再被任何存活记录引用的快照 blob 也会删除。

## 存储

```
<storageDir>/sessions/<session-id>/checkpoints.json
<storageDir>/sessions/<session-id>/objects/<sha256>.txt
<storageDir>/sessions/<session-id>/git/            # 私有 git 对象库
<storageDir>/trash/<session-id>/manifest.json
<storageDir>/trash/<session-id>/session/           # 搬入的会话日志
<storageDir>/trash/<session-id>/rewind/            # 搬入的快照
<storageDir>/parked.json                           # 待摘账号的已删会话
<storageDir>/trash-route.log                       # 路由挂载标记（排查用）
<storageDir>/trash-prune.log                       # 激活时的清扫报告
```

写入是原子的（临时文件 + rename）；快照按内容寻址，同一会话内去重。

## 说明

- 回合仍在进行时写下的 checkpoint 在列表里标 `进行中`：它可还原（代表该轮开始前的状态），回合结束后自动变为完整。
- 面向用户的文案是中文；命令名、工具名、配置键、存储记录与语言无关。
- 消息回滚菜单只有两项：**恢复代码**（只动文件）与**恢复代码并分叉**（先还原文件，再**新建并打开一个会话**）。`/rewind-message` 的宿主端调用 `sessionController.fork({ sessionId, atSeq: 该轮 turn/start 序号 - 1 })`（与客户端原生分叉同一个 controller，负责持久化与目录登记），把子会话改名为「父标题 (n)」，再把 id 交给客户端打开并回填原话。失败会以命令错误出现在对话里，不会在界面里静默消失。DSH 自带的「分叉会话」仍是纯分叉入口。
- 回填只还原**你真正输入的内容**：DSH 每步注入的运行时上下文是 `source.kind === 'runtime-context'` 的 `user/message`（包在 `<system-reminder>` 里），这些记录会被跳过并剥掉包裹，不会跑进输入框。图片无法回填：composer 的 `requestDraftInitialization` 只接受 `prompt` 文本。

## 测试

```
ELECTRON_RUN_AS_NODE=1 "<node>" test/run-tests.mjs        # 捕获/计划/还原/存储/记录器/命令
ELECTRON_RUN_AS_NODE=1 "<node>" test/git-tests.mjs        # git 轮次快照
ELECTRON_RUN_AS_NODE=1 "<node>" test/trash-tests.mjs      # 回收站存储
ELECTRON_RUN_AS_NODE=1 "<node>" test/trash-api-tests.mjs  # JSON 路由映射
ELECTRON_RUN_AS_NODE=1 "<node>" test/wiring-tests.mjs     # apply()：路由、命令、工具、服务
```

`<node>` 指当作 Node 用的桌面可执行文件（本机为 `D:\DeepSeek\DeepSeek Harness.exe`）。
