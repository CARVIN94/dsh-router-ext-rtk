/**
 * bash 调用拦截 —— ext-rtk **自己**挂 `tools/execute`、自己裁决、自己短路。
 *
 * 2026-09 重构:原来这层在 dsh-router 核心(`src/ext/proxy.ts`),核心代挂、代裁决、
 * 代短路。核心只在一个消费者时是纯亏损(共享表 + inject 广播 + 契约两份同步,只为
 * 留 40 行委派),所以归还插件:核心退成**管理面**(注册表面板 + 代存开关/数据)。
 *
 * 挂点语义:`tools/execute` 是 around-dispatch waterfall。我们不调 `next()` 短路整条
 * 链路。改写在 token 冻结之后、工具 body 执行之前发生:sandbox 审批 / guard 等前置
 * 已在 prepare 阶段做过,我们只在**同一授权的调用**里换命令字符串,不绕过任何审批。
 *
 * 关键不变量:
 *   - 只拦 `name === 'bash'`。其他工具(含 run_code 体内自起的子进程读取)不动。
 *   - 本插件未开启(核心 `extStore.isEnabled('rtk')`)或 rtk 未就绪 → 原样 `next()`。
 *   - 命中后直接调 bash 工具定义的 `execute(改写后参数, exec)`,返回
 *     `{ isError:false, value }`,由 registry 用名义 arguments(原始命令)re-render。
 *   - 任何一步出问题都退回 `next()`:命令永不因本扩展而失败。
 *
 * **头号坑(必须守住)**:`tools.get('bash', exec.agent)` 的第二个参数(agent scope)
 * 不能省。工具注册在 agent scope 里,只查全局视图查不到 'bash' → **静默走 next()、
 * 从不改写、不报错**。症状极具迷惑性(开关全开、命令正常、就是不生效)。
 *
 * ponytail: 天花板 —— 本插件自己挂监听,意味着多扩展插件各自挂时顺序不可控。目前
 *   只有 rtk 一家,无所谓;第二家出现时要收敛(升级路径:核心暴露顺序委派的共享工具
 *   方法,而不是收回拦截)。
 */
import { tryRewrite } from './rtk.ts'

/** Pending-call 的最小形状（只取我们需要的字段）。 */
export interface BashExec {
  name: string
  arguments: unknown
  signal: AbortSignal
  /** 调用方 agent —— `tools.get()` 必须带它，见文件头头号坑。 */
  agent?: unknown
}

/** `bash` 工具参数（只作用于 command 字段）。 */
interface BashArgs {
  command?: unknown
  [k: string]: unknown
}

/** around-wrapper 返回的规范化结果（registry 能消费的形状）。 */
export interface Envelope {
  isError: boolean
  value?: unknown
  error?: { message: string }
  content?: Array<{ type: 'text'; text: string }>
}

/** ToolRuntime 的最小可见面。get 的第二个参数是 scope(agent)。 */
interface ToolRuntimeFace {
  get(name: string, scope?: unknown): { execute: (args: unknown, exec: unknown) => Promise<unknown> } | undefined
}

/** ext id —— 与核心 ext.json 里的键、面板注册键一致。 */
export const RTK_EXT_ID = 'rtk'

/**
 * 挂 bash 拦截。返回清理函数（cordis 的 on 监听随 fiber 卸载自动注销，返回值供显式组合）。
 *
 * @param ctx cordis context（`get('tools')` 懒查工具服务，与加载顺序解耦）
 * @param isEnabled 读核心存的开关（本插件不存开关）
 * @param isReady 本插件自报的运行时就绪
 */
export function mountRtkIntercept(
  ctx: {
    get: (name: string) => unknown
    on: (name: string, listener: (...args: unknown[]) => unknown) => unknown
  },
  isEnabled: () => boolean,
  isReady: () => boolean,
  envBin?: string,
): () => void {
  const toolsOf = (): ToolRuntimeFace | undefined => {
    const t = ctx.get('tools')
    return t && typeof (t as { get?: unknown }).get === 'function' ? (t as ToolRuntimeFace) : undefined
  }

  const listener = async (exec: BashExec, next: () => Promise<Envelope>): Promise<Envelope> => {
    if (exec.name !== 'bash' || exec.signal.aborted) return next()
    const args = exec.arguments as BashArgs
    const cmd = args?.command
    if (typeof cmd !== 'string' || cmd.trim() === '') return next()

    // 裁决归本插件:开关(核心存的) + 就绪(自己报的),任一不满足 → 原样。
    if (!isEnabled()) return next()
    if (!isReady()) return next()

    const rewritten = tryRewrite(cmd, envBin).rewritten
    if (rewritten === null) return next()

    const tools = toolsOf()
    if (!tools) return next()
    // 必须带 agent scope —— 见文件头头号坑。
    const bashTool = tools.get('bash', exec.agent)
    if (!bashTool) return next()

    try {
      const value = await bashTool.execute({ ...args, command: rewritten }, exec)
      return { isError: false, value } as Envelope
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        error: { message },
        content: [{ type: 'text', text: `Error: ${message}` }],
      } as Envelope
    }
  }

  ctx.on('tools/execute', listener as never)
  return () => {}
}
