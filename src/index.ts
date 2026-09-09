/**
 * dsh-router-ext-rtk —— DSH 插件 host half。
 *
 * 通过 cordis service `router.ext`(聚合表 `{ [extId]: RouterExt }`)把 RTK 注册给
 * dsh-router,让面板/设置页能看到它;并**自己**挂 `tools/execute` 拦截 bash 调用。
 *
 * 2026-09 重构后的分工:
 *   - dsh-router 核心 = 管理面(注册表面板 + 代存开关/数据,`router.extStore`)。
 *   - 本插件 = 执行面(自己挂 tools/execute、自己按 enabled+ready 裁决、自己短路执行)。
 *
 * 本插件**无状态**:开关由 dsh-router 核心持久化(`<dataDir>/ext.json`),这里经
 * `router.extStore` 读,不自己 file IO、不存状态文件。
 *
 * cordis 的 `ctx.provide` 每个 service name 只允许一个插件注册,多个扩展插件不能各
 * 自 provide `router.ext`(会抛 "service has been registered")。本插件像供应商插件
 * 那样用共享表模式:`inject` 等待该 service(由 dsh-router 核心先 provide 空表),
 * 把 `rtk` 追加进共享表后广播一次 `internal/service`,让 dsh-router 读到。
 * 该模式与插件加载顺序无关。
 *
 * 拦截在拿到 `router.ext` 之后才挂(顺序:注册 → 拦截),所以开关/存储就绪前不会有
 * 半开的拦截窗口。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createRtkExt, resetProbe } from './rtk.ts'
import { mountRtkIntercept } from './intercept.ts'
import { currentExts, currentExtStore, type RouterExtService } from './contract.ts'

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

    // 自挂拦截:开关问核心存储,ready 问自己;裁决与短路都在 intercept.ts。
    // ctx 是 cordis Context,但 `on('tools/execute', ...)` 的鸭子签名鸭子类型过不去
    // (事件名是 keyof Events,字符串传不进)——与 dsh-router 核心同款 cast。
    const store = currentExtStore(sctx)
    const unmount = mountRtkIntercept(
      ctx as unknown as {
        get: (name: string) => unknown
        on: (name: string, listener: (...args: unknown[]) => unknown) => unknown
      },
      () => store?.isEnabled('rtk') === true,
      () => ext.getState().ready,
    )
    return () => {
      unmount()
      ext.dispose?.()
      delete exts.rtk
      resetProbe()
    }
  })
}

// 类型引用确保契约副本被编译检查(避免死代码引起的不一致漂移)。
export type { RouterExtService }
