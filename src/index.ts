/**
 * dsh-router-ext-rtk —— DSH 插件 host half。
 *
 * 通过 cordis service `router.ext`(聚合表 `{ [extId]: RouterExt }`)把 RTK
 * 命令改写扩展器注册给 dsh-router。
 *
 * 本插件**无状态**:开关由 dsh-router 核心持久化(`<dataDir>/ext.json`)并裁决,
 * 这里只提供「怎么改写一条命令」+「rtk 是否可用」。所以不需要数据目录。
 *
 * cordis 的 `ctx.provide` 每个 service name 只允许一个插件注册,多个扩展插件不能各
 * 自 provide `router.ext`(会抛 "service has been registered")。本插件像供应商插件
 * 那样用共享表模式:`inject` 等待该 service(由 dsh-router 核心先 provide 空表),
 * 把 `rtk` 扩展器追加进共享表后广播一次 `internal/service`,让 dsh-router 读到。
 * 该模式与插件加载顺序无关:dsh-router 的 on 监听 + inject 兜底总有一条路径能读到
 * 追加后的 live 表。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createRtkExt } from './rtk.ts'
import { currentExts, type RouterExtService } from './contract.ts'

export const name = 'dsh-router-ext-rtk'

export function apply(ctx: Context): void {
  // 等 router.ext 可用后,把 rtk 追加进共享聚合表并通知 dsh-router 重扫。
  ctx.inject(['router.ext'], (sctx) => {
    const exts = currentExts(sctx)
    if (!exts) return undefined
    if (exts.rtk) return undefined // 已注册
    const ext = createRtkExt()
    exts.rtk = ext
    ctx.emit('internal/service', 'router.ext', exts)
    ctx.logger?.info?.('[dsh-router-ext-rtk] registered router.ext: rtk')
    return () => {
      ext.dispose?.()
      delete exts.rtk
    }
  })
}

// 类型引用确保契约副本被编译检查(避免死代码引起的不一致漂移)。
export type { RouterExtService }