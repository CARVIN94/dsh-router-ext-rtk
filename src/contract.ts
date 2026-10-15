/**
 * `router.ext` 通用契约副本 —— 与 dsh-router/src/ext/contract.ts 逐字同步。
 *
 * dsh-router-ext-rtk 是独立 npm 包,不能 import dsh-router 的 src(避免安装期
 * 依赖拉取整个路由核心),所以复制这份契约。改动契约必须**两处同步**
 * (dsh-router/src/ext/contract.ts + 本文件)——鸭子类型,tsc 抓不到跨仓漂移。
 *
 * 分工(2026-09 重构):dsh-router 核心只做**管理面**(注册表面板 + 代存开关/数据),
 * 拦截 `tools/execute`、裁决 enabled+ready、短路执行全部归扩展插件自己。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 扩展器唯一 id（注册键）。 */
export type ExtId = string

/**
 * 扩展器当前状态（**运行时事实**，由插件现算，不持久化）。
 *
 * 注意：`enabled` 不在这里 —— 开关状态归核心持久化（`<dataDir>/ext.json`），
 * 插件只负责做事 + 报自己是否可用。
 */
export interface ExtState {
  /** 运行时是否就绪（如 RTK 二进制是否可用）；false 时即使开启也不生效。 */
  ready: boolean
  /** 不就绪时的一句话说明（如「本机未装 rtk」），面板红字显示。 */
  detail?: string
}

/**
 * 注册到 `router.ext` 表的扩展器实现。核心（面板/API）只认这几个成员。
 * 注意**没有 `rewrite`** —— 怎么改一条命令是插件的私事，核心不感知。
 */
export interface RouterExt {
  /** 扩展器 id，也是 `router.ext` 表里的注册键。 */
  readonly id: ExtId
  /** 面板显示名（如「RTK」）。 */
  readonly name: string
  /** 面板副标题说明。 */
  readonly description?: string
  /** 卡片/详情图标的 logo URL（可选；缺省用默认图标）。 */
  readonly icon?: string
  /** 当前运行时状态（ready + 不就绪时的说明）。 */
  getState(): ExtState
  /** 卸载清理（表删除时由 dsh-router 调用，可选）。 */
  dispose?(): void
}

/** 面板/API 用的一条扩展器信息 = 核心存的开关 + 插件报的运行时事实。 */
export interface ExtInfo {
  id: string
  name: string
  description?: string
  /** 卡片/详情图标 logo URL（可选）。 */
  icon?: string
  /** 核心持久化的开关（默认关）。 */
  enabled: boolean
  /** 插件报的运行时就绪状态。 */
  ready: boolean
  /** 不就绪时的说明（面板红字）。 */
  detail?: string
}

/** `router.ext` 共享聚合表：`{ [extId]: RouterExt }`（同一 live 对象可追加）。 */
export interface RouterExtService {
  [extId: string]: RouterExt
}

/**
 * 扩展的存储面（核心 provide，插件 inject）。
 *
 * 插件**不自己 file IO**：落盘位置由核心锚定（不跟 cwd 跑），读写都经核心。
 * 落盘形状：`<dataDir>/ext.json` = `{ "<id>": { "enabled": boolean, "data": unknown } }`
 */
export interface ExtStoreService {
  /** 是否开启（未记录过 = 默认关）。 */
  isEnabled(id: string): boolean
  /** 置开关（面板/API 调）。 */
  setEnabled(id: string, enabled: boolean): void
  /** 读插件自己的数据块（没有 = undefined）。 */
  readData<T = unknown>(id: string): T | undefined
  /** 写插件自己的数据块（覆盖；与 enabled 同文件原子落盘）。 */
  writeData(id: string, value: unknown): void
}

/** 读取当前 router.ext 表（同一 live 对象，可追加）。 */
export function currentExts(ctx: Context): RouterExtService | undefined {
  const c = ctx as unknown as {
    get?: (key: string) => unknown
    router?: { ext?: RouterExtService }
  }
  return (c.get?.('router.ext') ?? c.router?.ext) as RouterExtService | undefined
}

/** 读取扩展存储服务——插件用它读开关、读写自己存的数据。 */
export function currentExtStore(ctx: Context): ExtStoreService | undefined {
  const c = ctx as unknown as {
    get?: (key: string) => unknown
    router?: { extStore?: ExtStoreService }
  }
  return (c.get?.('router.extStore') ?? c.router?.extStore) as ExtStoreService | undefined
}
