/**
 * `router.ext` 通用契约副本 —— 与 dsh-router/src/ext/contract.ts 逐字同步。
 *
 * dsh-router-ext-rtk 是独立 npm 包,不能 import dsh-router 的 src(避免安装期
 * 依赖拉取整个路由核心),所以复制这份契约。改动契约必须**两处同步**
 * (dsh-router/src/ext/contract.ts + 本文件)——鸭子类型,tsc 抓不到跨仓漂移。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 扩展器唯一 id（注册键）。 */
export type ExtId = string

/**
 * 扩展器当前状态(**运行时事实**,由插件现算,不持久化)。
 *
 * 注意:`enabled` 不在这里 —— 开关状态归核心持久化(`<dataDir>/ext.json`),
 * 插件只负责做事 + 报自己是否可用。核心把两者合并后再给面板/裁决用。
 */
export interface ExtState {
  /** 运行时是否就绪(如 RTK 二进制是否可用);false 时即使开启也不改写。 */
  ready: boolean
  /** 不就绪时的一句话说明(如「本机未装 rtk」),面板红字显示。 */
  detail?: string
}

/** `rewrite` 一次返回：改写后的命令，或 `{ rewritten: null }` 表示原样执行。 */
export type RewriteResult = { rewritten: string } | { rewritten: null }

/** 注册到 `router.ext` 表的扩展器实现。核心只认这几个方法，插件可带更多内部状态。 */
export interface RouterExt {
  readonly id: ExtId
  readonly name: string
  readonly description?: string
  rewrite(command: string): RewriteResult
  /** 当前运行时状态(ready + 不就绪时的说明)。 */
  getState(): ExtState
  /** 卸载清理(表删除时由 dsh-router 调用,可选)。 */
  dispose?(): void
}

/** 面板/API 用的一条扩展器信息 = 核心存的开关 + 插件报的运行时事实。 */
export interface ExtInfo {
  id: string
  name: string
  description?: string
  /** 核心持久化的开关(默认关)。 */
  enabled: boolean
  /** 插件报的运行时就绪状态。 */
  ready: boolean
  /** 不就绪时的说明(面板红字)。 */
  detail?: string
}

/** `router.ext` 共享聚合表：`{ [extId]: RouterExt }`（同一 live 对象可追加）。 */
export interface RouterExtService {
  [extId: string]: RouterExt
}

/** 读取当前 router.ext 表（同一 live 对象，可追加）。 */
export function currentExts(ctx: Context): RouterExtService | undefined {
  const c = ctx as unknown as {
    get?: (key: string) => unknown
    router?: { ext?: RouterExtService }
  }
  return (c.get?.('router.ext') ?? c.router?.ext) as RouterExtService | undefined
}