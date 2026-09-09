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

单独装它没用——核心提供**面板与开关存储**,本插件提供**改写与拦截**。

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
| 开关持久化 | 状态存核心的 `<profile>/data/ext.json`,默认关(**插件经 `router.extStore` 读写,不自己存**)。 |

> 实测:`ls` 走代理后输出变成 rtk 树形格式(带文件大小与 `... (N filtered)`),
> `rtk gain` 报 3 条命令省 280 tokens(61.9%)。

## 配置

| 环境变量 | 作用 |
|---|---|
| `DSH_RTK_BIN` | 显式指定 rtk 可执行文件路径。缺省走 `PATH`,再兜底常见安装路径(`~/.local/bin/rtk`、`/opt/homebrew/bin/rtk`、`/usr/local/bin/rtk`、`~/.cargo/bin/rtk`)。 |

## 与核心的分工

核心 = **管理面**,本插件 = **执行面**(2026-09 重构:拦截与裁决从核心归还插件,
核心只在一个消费者时代挂是纯亏损)。

核心负责:持有 `router.ext` 注册表(发现)、渲染面板与 `/router/api/ext`(展示)、
把开关与插件数据落盘 `<dataDir>/ext.json`(`router.extStore` service)、按
`getState().ready` 裁决能否开启(不可用时拒 409、面板开关禁开)。

本插件负责:**自己挂 `tools/execute` 拦截 bash**、按「核心存的 `enabled` + 自己报的
`ready`」裁决、命中则用改写后的命令短路执行;`rtk rewrite` 退出码解读与探活也在这里。

本插件**无状态**:开关与数据都经 `router.extStore` 读写(`isEnabled` / `readData`),
不自己 file IO、没有数据目录。

```
src/
  index.ts       插件入口(host 半,注册 rtk 扩展器 + 挂拦截)
  intercept.ts   拦截实现(挂 tools/execute、裁决、短路)—— 无状态
  rtk.ts         RTK 扩展器实现(rewrite 退出码解读、rtk 定位/探活)—— 无状态
  contract.ts    router.ext 契约副本(自含,与 dsh-router 契约同步)
  *.test.ts      测试
cordis.patch.yml  bundle patch,把插件插入 DSH cordis bundle stack
```

> ponytail: 天花板 —— 本插件自己挂监听,多扩展插件各自挂时**顺序不可控**。目前只有
> rtk 一家,无所谓;第二家出现时要收敛(升级路径:核心暴露顺序委派的共享工具方法,
> 而不是收回拦截)。
>
> **头号坑**:`tools.get('bash', exec.agent)` 的 agent scope 不能省 —— 不带只查全局
> 视图,查不到 → 静默走原样、从不改写、不报错。已在 `intercept.ts` 文件头 + 测试锁定。

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
