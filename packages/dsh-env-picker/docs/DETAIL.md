# 会话环境选择器

为每个会话管理 Python / Node.js / C / C++ / Java / 调试器 六类环境，并把选择写成提示词注入每个请求。

## 使用

输入框左下角的按钮显示所有**已启用**语言的当前环境（C 与 C++ 共用同一套工具链时合并显示）。点开后，面板以**浮层**形式盖在对话上方展开（宽度为输入框的 70%，不挤压输入框；点面板外或按 Esc 关闭），是环境管理器：

- **语言分页**：Python / Node.js / C / C++ / Java / 调试器，每页只管理一种语言；被关闭的语言标签会变灰并划线。
- **启用开关**：`已启用 / 已关闭` 药丸按钮，一键关闭某种语言——关闭后它不会出现在按钮上，也不会写进提示词。
- **环境列表**：每行显示名称 + 可执行文件路径，点行即选中；行右侧 `×` 删除自定义环境、隐藏自动检测到的环境（不会动磁盘）。列表内部滚动，20 个环境也不会撑坏窗口。
- **恢复隐藏项**：有隐藏项时显示 `恢复 N 项`。
- **添加环境**：底部「名称 + 可执行文件路径」两个输入框，回车或点 `+ 添加` 即加入并在本会话选中；添加的自定义项带「自定义」标记。

所有改动都通过 `/env` 命令写进会话日志，等价命令：

```
/env                    查看当前状态
/env python D2          切换
/env add python "我的环境" D:\Python311\python.exe
/env remove python base 删除自定义项 / 隐藏检测项
/env show all python    恢复隐藏项
/env enable|disable java
/env reset              恢复默认（保留自定义项）
```

## 注入的提示词

只包含**已启用**的语言（以当前选择渲染）：

```markdown
## 指定运行环境
我指定你在 Python 环境：D2（…\python.exe），Node.js 环境：系统 PATH（PATH 中的 node），
C 环境：GCC 15.2.0（Scoop）（…\gcc.exe），C++ 环境：…（…\g++.exe），
Java 环境：JDK 21.0.10（…\java.exe），调试器 环境：GDB 17.1（…\gdb.exe）。

- Python：使用 `& "...\python.exe" ...`（也可用 `conda run -n D2 python ...`），不要调用 PATH 上的其它 python。
- Node.js：使用 `node ...`。
- C：编译用 `& "...\gcc.exe" ...`；编译前把该 bin 目录放到 PATH 前面。
- C++：编译用 `& "...\g++.exe" ...`；编译前把该 bin 目录放到 PATH 前面。
- Java：`& "...\javac.exe"` 编译，`& "...\java.exe"` 运行；JAVA_HOME 设为 `C:\Java\jdk-21`。
- 调试器：使用 `& "...\gdb.exe"`（gdb）。
```

同时每次 shell 调用只带已启用语言的 `DSH_PYTHON` / `DSH_NODE` / `DSH_CC` / `DSH_CXX` / `DSH_GDB` / `DSH_JAVA` / `DSH_JAVA_HOME`。

## 环境来源（自动检测）

1. **Python**：`conda env list --json` 探测到的环境（直接指向各环境的 `python.exe`）→ 系统 PATH → `~/.dsh/dsh-runtimes` 自带 Python；
2. **Node.js**：系统 PATH → `~/.dsh/dsh-runtimes` 自带 Node；
3. **C / C++**：PATH 上的 `gcc`、常见目录（`C:\msys64\{mingw64,ucrt64,clang64}\bin`、`C:\mingw64\bin`、`C:\MinGW\bin`、`C:\Program Files\LLVM\bin`）；C 行指向 `gcc.exe`，C++ 行指向同目录的 `g++.exe`；
4. **调试器**：PATH 上的 `gdb`、常见目录里的 `gdb.exe`；
5. **Java**：`JAVA_HOME` → PATH 上 `java` 所在 JDK → 扫描 `C:\Program Files\{Java,Eclipse Adoptium,Microsoft,Zulu,BellSoft,Amazon Corretto,AdoptOpenJDK}`，版本读 JDK 的 `release` 文件。

config 里还可以用 `python` / `node` / `c` / `cpp` / `java` / `gdb` 数组预置环境（元素形如 `{ id, label, path, home }`）。

## 状态与持久化

选择、开关、自定义项、隐藏项全部来自会话日志的既有 `command/run` 记录（未新增事件类型），因此 fork、重启、重放都能还原；Host 把它投影成 `envPicker` 给客户端读取。

## 已知限制

- 只影响 agent 的 shell 调用与提示词；集成终端的 shell、`workflow` 的 JS 沙箱不跟随。
- 子会话（subagent）使用默认环境，不继承父会话的选择。
- 自定义环境保存在当前会话；新会话需要重新添加（或写进 config）。
- C/C++ 只探测 GCC/MinGW/LLVM 命令行工具链，不含 Visual Studio 的 `cl.exe`（需要 vcvars）。
