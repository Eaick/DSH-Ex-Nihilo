# NIHILO

> *ex nihilo* —— 无中生有。

DeepSeek Harness（[DSH](https://github.com/deepseek-ai/deepseek-harness)）的插件合集。从零写起，一次只做一件事：多一个按钮、多一条命令、多一次后悔药。

套件名 **DSHEN**（DSH + *ex nihilo*），插件包统一 `dshen-` 前缀。

| 插件 | 做什么 | 说明 |
|---|---|---|
| **dshen-env-picker** | 输入框左下多一个环境按钮：按会话选 Python / Node.js / C / C++ / Java / GDB，选择写进提示词 | [说明](packages/dsh-env-picker) |
| **dshen-rewind** | 每一轮改文件前先留快照（`/rewind`）；归档的会话进回收站，可还原或彻底删除 | [说明](packages/dsh-rewind) |
| **dshen** | 套件：把上面这些打成一包（需先在仓库里 `pnpm install`，未对外发布） | [说明](packages/dshen) |

## 安装

目前没有发布到任何包管理器，只能**下载仓库后从本地目录装**。前提：DSH `0.2.2-rc.3` 及以上。

1. 下载仓库：页面右上 **Code → Download ZIP**，或者 `git clone https://github.com/Eaick/DSH-Ex-Nihilo.git`
2. 解压到任意位置（路径里最好别有空格）
3. 打开 DSH：**插件 → 添加插件**，填入插件目录的绝对路径：
   - 环境选择器：`<解压目录>\packages\dsh-env-picker`
   - 回收站 / 回滚：`<解压目录>\packages\dsh-rewind`
4. 刷新一次页面

装好后的样子：

- 输入框左下角多出环境按钮，显示当前 Python / Node.js 环境；
- 侧边栏 Plugins / Schedules 旁多出「回收站」，助手消息的工具调用下方多出回滚菜单。

不想点界面也可以对 agent 说：`install_bundle`，`target` 填这两个目录的绝对路径。

## 兼容性

- DSH：每个包声明 `engines.dsh = ^0.2.2-rc.3`，版本不匹配时安装会被拒绝，而不是装上后崩溃。
- 平台：Web 客户端（`platform: web`）。
- 无需构建：`client.js` 是浏览器可直接加载的模块。

## 许可

[MIT](LICENSE)。这些插件基于 DSH 的公开插件 API 实现，与 DeepSeek 官方无隶属关系。

---

维护者：开发、测试、改包名的注意事项见 [CONTRIBUTING.md](CONTRIBUTING.md)。
