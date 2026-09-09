/**
 * RTK (Rust Token Killer) 扩展器 —— 只负责「改写一条命令」+「报自己是否可用」。
 *
 * 开关状态**不归本插件管**:核心持久化(`<dataDir>/ext.json`)并代存,插件经
 * `router.extStore` service 读,不自己 file IO、没有状态文件。
 *
 * 拦截/裁决/短路也不归这里 —— 见 `intercept.ts`(本插件自己挂 `tools/execute`)。
 *
 * 真实代理语义:对每条 bash 命令调 `rtk rewrite "<cmd>"`,按 rtk 的退出码协议
 * 解读。注意 rtk 的权限默认是 Ask(least-privilege),几乎没有命令会稳定落到
 * Allow(0)——常见命令(git status / ls / cat …)都走 Ask(3)。我们这里做**真实
 * 代理**:用户已经在面板**显式开启**了开关 = 明确授权改写,所以 Ask(3) 也直接
 * 采用 stdout,不弹任何二次确认。只有兜底命令按原文理解:无等价(1)放行、
 * Deny(2)原样(不阻断)、spawn 失败放行。
 *
 *   | 退出码 | 语义                                                      | 行为                 |
 *   |--------|-----------------------------------------------------------|----------------------|
 *   | 0      | Allow,有等价改写                                          | 采用 stdout          |
 *   | 1      | 无等价,原样                                               | 放行                 |
 *   | 2      | Deny 规则(Claude 原生 deny)                               | 放行(不做阻断)       |
 *   | 3      | Ask,有等价改写但默认要人工确认                             | **采用 stdout**——用户已授权,
 *   |        |                                                           | 真实代理不弹确认框    |
 *
 * 状态(只报运行时事实,不持久化):
 *   - `ready`:rtk 二进制是否可用。未装 rtk 时核心会拒绝开启(面板开关禁开、
 *     API 拒 409),并在内容区红字显示 `detail`。
 *   - `detail`:不就绪时的说明(「本机未装 rtk…」)。
 *
 * rtk 二进制定位优先顺序:
 *   1. `$DSH_RTK_BIN`(显式覆盖)
 *   2. `rtk`(PATH)
 *   3. 常见路径兜底: `~/.local/bin/rtk`、`/opt/homebrew/bin/rtk`、`/usr/local/bin/rtk`、`~/.cargo/bin/rtk`
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ExtState } from './contract.ts'

/**
 * 一次改写的结果:改写后的命令,或 `{ rewritten: null }` 表示原样执行。
 *
 * 本插件私有(不在 `router.ext` 契约里)—— 怎么改命令是插件的实现细节,核心不感知。
 */
export type RewriteResult = { rewritten: string } | { rewritten: null }

/** rtk rewrite 退出码(与 rtk hooks/claude 一致)。 */
const RTK_EXIT_ALLOW = 0
const RTK_EXIT_NO_REWRITE = 1
const RTK_EXIT_DENY = 2
const RTK_EXIT_ASK = 3

/** 常见 rtk 安装路径(brew / quick-install ~/.local/bin / cargo)。 */
const FALLBACK_RTK_PATHS = [
  '~/.local/bin/rtk',
  '/opt/homebrew/bin/rtk',
  '/usr/local/bin/rtk',
  '~/.cargo/bin/rtk',
]

/** 展开首个 `~/` 前缀。 */
function expandHome(p: string): string {
  return p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p
}

/**
 * 定位 rtk 可执行文件。返回 `'rtk'`(走 PATH,交给 execFileSync 解析)、绝对路径,
 * 或 `undefined`(找不到)。不缓存——`rewrite` 每次重查,避免「装了 rtk 后被缓存的
 * 失败卡死」;探活缓存见 `rtkReady`。
 */
export function resolveRtkBin(envBin?: string): string | undefined {
  const explicit = envBin !== undefined && envBin !== '' ? [envBin] : []
  for (const raw of [...explicit, 'rtk', ...FALLBACK_RTK_PATHS]) {
    if (raw === 'rtk') return 'rtk' // PATH 命中交给 execFileSync(找不到时 execute 抛错,由 tryRewrite 兜)
    const p = expandHome(raw)
    try {
      accessSync(p, constants.X_OK)
      return p
    } catch {
      // 下一个候选
    }
  }
  return undefined
}

/** rtk 可用性探活(缓存:成功存版本,失败存 null)。 */
let probe: string | null | undefined = undefined

export function resetProbe(): void {
  probe = undefined
}

function rtkReady(): boolean {
  if (probe !== undefined) return probe !== null
  try {
    const out = execFileSync('rtk', ['--version'], { encoding: 'utf8', timeout: 2000 }).trim()
    probe = out === '' ? null : out
  } catch {
    probe = null
  }
  return probe !== null
}

/**
 * 调 `rtk rewrite` 并解释退出码。缺 rtk / spawn 失败 / 无改写 → 放行,永不抛。
 */
export function tryRewrite(command: string, bin?: string): RewriteResult {
  let target = bin
  if (target === undefined) {
    target = resolveRtkBin(process.env.DSH_RTK_BIN)
    // 探活失败(rtk 不在 PATH 且不在 FALLBACK)→ 放行
    if (target === 'rtk') {
      try {
        execFileSync('rtk', ['--version'], { encoding: 'utf8', timeout: 2000 })
      } catch {
        return { rewritten: null }
      }
    } else if (target === undefined) {
      return { rewritten: null }
    }
  }
  let out: string | undefined
  let code = 0
  try {
    out = execFileSync(target, ['rewrite', command], { encoding: 'utf8', timeout: 2000 }).trim()
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer }
    if (typeof e.status !== 'number') return { rewritten: null } // spawn 失败放行
    code = e.status
    out = (e.stdout ?? '').toString().trim()
    if (code === RTK_EXIT_DENY) return { rewritten: null } // deny 规则:原样,不阻断
    if (code === RTK_EXIT_NO_REWRITE) return { rewritten: null }
    // 退出码 3(Ask):真实代理下用户已授权,采用 stdout(前提是确实现改了)。
    if (code !== RTK_EXIT_ALLOW && code !== RTK_EXIT_ASK) return { rewritten: null }
    if (out === '') return { rewritten: null }
  }
  // 退出码 0/3 + 非空输出且确实改写 → 采用;否则原样。
  if ((code === RTK_EXIT_ALLOW || code === RTK_EXIT_ASK) && out !== '' && out !== command) {
    return { rewritten: out }
  }
  return { rewritten: null }
}

/**
 * 组装 ext-rtk 的扩展器实例(注册进 router.ext 表)。
 *
 * 注意:不接收 stateFile —— 开关归核心存,插件无状态(除 rtk 探活缓存)。
 * 契约里没有 `rewrite`:核心只认声明 + getState,改命令是本插件自己拦截时用的。
 */
export function createRtkExt(envBin?: string) {
  // 启动即自检:探测 rtk 是否可用(缓存到 probe),让核心初次 getState 就有 ready
  // /detail,而不是等到第一次 rewrite 才懒查。用户后续装好 rtk,重启插件后恢复。
  rtkReady()
  return {
    id: 'rtk',
    name: 'RTK',
    description: 'bash 命令输出压缩,削减发给 LLM 的 60–90% bash 输出(需本机装 rtk)',
    getState: (): ExtState => {
      const ready = rtkReady()
      return {
        ready,
        detail: ready
          ? undefined
          : '本机未装 rtk:brew install rtk 或 curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh',
      }
    },
    dispose: (): void => {
      resetProbe()
    },
  }
}