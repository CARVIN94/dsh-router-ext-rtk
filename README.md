<h1 align="center">dsh-router-ext-rtk</h1>

<p align="center">dsh-router 的 RTK 扩展插件</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-router-ext-rtk"><img src="https://img.shields.io/npm/v/dsh-router-ext-rtk?style=flat-square&logo=npm&label=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square" alt="MIT license"></a>
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.1.2-rc.1+" src="https://img.shields.io/badge/DSH-0.1.2--rc.1%2B-4d6bfe" /></a>
</p>

<p align="center">
  <a href="#快速安装">快速安装</a> ·
  <a href="#能力">能力</a> ·
  <a href="#与核心的分工">与核心的分工</a> ·
  <a href="https://github.com/CARVIN94/dsh-router/blob/main/docs/ext.md">扩展开发</a>
</p>

为 [dsh-router](https://github.com/CARVIN94/dsh-router) 提供 **RTK(Rust Token Killer)**
真实代理:把 agent 每次 bash 工具调用改写成 `rtk <cmd>`(如 `git status` →
`rtk git status`),削减发给 LLM 的 60–90% bash 输出。

单独装它没用——它只是向核心注册一个扩展器,拦截、开关、面板都在核心里。

## 快速安装

先装核心,再装本插件,然后**重启 `dsh web`**:

```bash
dsh plugin --profile web add dsh-router-core
dsh plugin --profile web add dsh-router-ext-rtk
```

`dsh plugin add` 会在 profile 里 `pnpm add`,并自动把声明了 `dsh.bundle.patch`
的包加入 `dsh.profile.bundles`(本插件即声明了,见 `cordis.patch.yml`)。

然后在「设置 → 路由 → **扩展**」页打开 **RTK** 开关。

### 前置:本机装 RTK

RTK 是 [rtk-ai/rtk](https://github.com/rtk-ai/rtk)(Rust Token Killer),
**不是** Rust Type Kit(`reachingforthejack/rtk`)。

```bash
brew install rtk
# 或
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

验证:

```bash
rtk --version   # 应返回 0.x
rtk gain        # 应显示 token 节省统计(不是 command not found)
```

**未装 rtk 时开关开不了**:插件启动自检会报 `ready:false`,核心拒绝开启(API 409),
面板内容区红字提示原因。装上后重启 `dsh web` 即可。

## 能力

| 能力 | 说明 |
|---|---|
| 真实代理 | 每条 bash 命令经 `rtk rewrite` 改写后执行,LLM 读的是压缩后的输出。 |
| 降级安全 | rtk 缺失 / 无等价改写 / spawn 失败 → 命令原样执行,**绝不报错**。 |
| 只拦 bash | 其他工具(含 `run_code` 体内自起的子进程)不动。 |
| 开关自检 | 启动时探测 rtk;不可用时核心拒绝开启并给出问题描述。 |
| 开关持久化 | 状态存核心的 `<profile>/data/ext.json`,默认关(**本插件不存**)。 |

> 实测:`ls` 走代理后输出变成 rtk 树形格式(带文件大小与 `... (N filtered)`),
> `rtk gain` 报 3 条命令省 280 tokens(61.9%)。

## 配置

| 环境变量 | 作用 |
|---|---|
| `DSH_RTK_BIN` | 显式指定 rtk 可执行文件路径。缺省走 `PATH`,再兜底常见安装路径(`~/.local/bin/rtk`、`/opt/homebrew/bin/rtk`、`/usr/local/bin/rtk`、`~/.cargo/bin/rtk`)。 |

## 与核心的分工

本插件**无状态**,只管**怎么改写一条命令** + **自己是否可用**:调 `rtk rewrite`、
解释退出码、探测 rtk。

开关**不归本插件管**:核心持久化(`<dataDir>/ext.json`)并裁决是否开启,
本插件是被调用方。

**拦截与裁决全在核心**(`router.ext` + `tools/execute`):

- 核心持有 `router.ext` 空表,本插件往里注册 `rtk` 扩展器
- 核心在 `tools/execute` 拦截 bash 调用,把命令交给表里 **已开启且 ready** 的扩展器
- 命中则短路执行改写后的命令;未命中走原样
- 核心按 `getState().ready` 裁决能否开启(不可用时拒 409)

完整契约见 [dsh-router 的 `docs/ext.md`](https://github.com/CARVIN94/dsh-router/blob/main/docs/ext.md)。

### `rtk rewrite` 退出码

RTK 权限默认 least-privilege,**几乎没有命令会落到 Allow(0)**——常见命令
(`git status` / `ls` / `cat` …)都返回 **Ask(3)**。真实代理下用户已显式开启开关
= 授权改写,所以退出码 3 也**采用** stdout,不弹二次确认:

| 退出码 | 语义 | 行为 |
|---|---|---|
| 0 | Allow,有等价改写 | 采用 stdout |
| 1 | 无等价 | 放行(原样执行) |
| 2 | Deny 规则 | 放行(不做阻断) |
| 3 | Ask,有等价改写但默认要人工确认 | **采用 stdout**——用户已授权 |
| — | spawn 失败 / 超时(2s) | 放行 |

## 架构

通过 cordis service `router.ext` 的**共享聚合表**向 dsh-router 注册 `rtk` 扩展器
(cordis 每个 service name 只允许一个插件 `provide`,本插件 `inject` 等核心先提供该表
后追加并广播 `internal/service`,与加载顺序无关)。

```
src/
  index.ts      插件入口(host 半,经 cordis service router.ext 注册 rtk 扩展器)
  rtk.ts        RTK 扩展器实现(rewrite 退出码解读、rtk 定位/探活)—— 无状态
  contract.ts   router.ext 契约副本(自含,与 dsh-router 契约同步)
  rtk.test.ts   测试
cordis.patch.yml  bundle patch,把插件插入 DSH cordis bundle stack
```

> 没有 `data-dir.ts`:开关由 dsh-router 核心存,插件不需要数据目录。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build        # lib/index.js
```

## 致谢

- [rtk-ai/rtk](https://github.com/rtk-ai/rtk) —— Rust Token Killer,命令输出压缩器。

## 许可证

[MIT](LICENSE)

## 免责声明

本项目仅用于学习与技术研究,请勿用于商业用途。
