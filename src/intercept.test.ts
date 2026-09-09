/**
 * bash 拦截测试 —— node --test 直接跑。
 *
 * 锁定 2026-09 重构后归本插件的裁决/短路语义:
 *   - 开关关 / rtk 不就绪 → 原样 next(),绝不改写
 *   - 只拦 bash;非 bash、command 非字符串、已 abort → 原样
 *   - 命中后用**改写后**的命令执行
 *   - `tools.get('bash', exec.agent)` 必须带 agent scope —— 不带查不到,静默原样(头号坑)
 *   - 执行抛错 → 转成 error envelope,不向外抛
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountRtkIntercept, RTK_EXT_ID, type BashExec, type Envelope } from './intercept.ts'

/** 造一个真能跑的假 rtk:`rtk rewrite <cmd>` → 输出 `RTK(<cmd>)`,退出码 0。 */
function fakeRtkBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ext-rtk-'))
  const fp = join(dir, 'rtk')
  writeFileSync(fp, '#!/bin/sh\necho "RTK($2)"\n')
  chmodSync(fp, 0o755)
  return fp
}

interface Ctx {
  get: (name: string) => unknown
  on: (name: string, fn: unknown) => unknown
}

/** 最小 cordis-like ctx:记录 tools.get 的调用,并交出监听函数供手动触发。 */
function fakeCtx(opts: { bashTool?: { execute: (args: unknown, exec: unknown) => Promise<unknown> } } = {}) {
  const gets: Array<{ name: string; scope: unknown }> = []
  let listener: ((exec: BashExec, next: () => Promise<Envelope>) => Promise<Envelope>) | undefined
  const ctx: Ctx = {
    get: (name) => (name === 'tools' ? { get: (n: string, scope?: unknown) => {
      gets.push({ name: n, scope })
      return n === 'bash' && scope !== undefined ? opts.bashTool : undefined
    } } : undefined),
    on: (name, fn) => {
      if (name === 'tools/execute') listener = fn as typeof listener
      return () => {}
    },
  }
  const call = (exec: BashExec): { res: Promise<Envelope>; nexted: () => boolean } => {
    let nexted = false
    const res = (listener as NonNullable<typeof listener>)(exec, async () => {
      nexted = true
      return { isError: false }
    })
    return { res, nexted: () => nexted }
  }
  return { ctx, gets, call }
}

const RTK_BIN = fakeRtkBin()

/** 挂拦截,返回 ctx 与触发入口。`bin` 缺省用一个真能改写的假 rtk。 */
function setup(o: { enabled?: boolean; ready?: boolean; bin?: string; execute?: (args: unknown, exec: unknown) => Promise<unknown> } = {}) {
  const h = fakeCtx(o.execute === undefined ? {} : { bashTool: { execute: o.execute } })
  const unmount = mountRtkIntercept(
    h.ctx,
    () => o.enabled !== false,
    () => o.ready !== false,
    o.bin ?? RTK_BIN,
  )
  return { ...h, unmount }
}

function bashExec(over: Partial<BashExec> = {}): BashExec {
  return { name: 'bash', arguments: { command: 'git status' }, signal: new AbortController().signal, agent: 'a1', ...over }
}

test('ext id 与核心 ext.json 的键一致', () => {
  assert.equal(RTK_EXT_ID, 'rtk')
})

test('开关关 → 原样,不查工具', async () => {
  const h = setup({ enabled: false, ready: true })
  const { res, nexted } = h.call(bashExec())
  await res
  assert.equal(nexted(), true)
  assert.equal(h.gets.length, 0)
})

test('rtk 不就绪 → 原样,不查工具', async () => {
  const h = setup({ enabled: true, ready: false })
  const { res, nexted } = h.call(bashExec())
  await res
  assert.equal(nexted(), true)
  assert.equal(h.gets.length, 0)
})

test('非 bash 工具 → 原样', async () => {
  const h = setup()
  const { res, nexted } = h.call(bashExec({ name: 'read' }))
  await res
  assert.equal(nexted(), true)
  assert.equal(h.gets.length, 0)
})

test('command 非字符串 / 已 abort → 原样', async () => {
  const h = setup()
  const a = h.call(bashExec({ arguments: { command: 42 } }))
  const aborted = new AbortController()
  aborted.abort()
  const b = h.call(bashExec({ signal: aborted.signal }))
  await a.res
  await b.res
  assert.equal(a.nexted(), true)
  assert.equal(b.nexted(), true)
})

test('命中 → 用改写后的命令执行(不是原命令)', async () => {
  const executed: Array<{ command?: unknown }> = []
  const h = setup({ execute: async (args) => {
    executed.push(args as { command?: unknown })
    return 'OK'
  } })
  const { res, nexted } = h.call(bashExec())
  const out = await res
  assert.equal(nexted(), false, '命中后不应再走 next()')
  assert.deepEqual(executed, [{ command: 'RTK(git status)' }])
  assert.equal(out.isError, false)
})

test('tools.get 必须带 agent scope —— 不带查不到 bash,静默原样(头号坑)', async () => {
  let ran = 0
  const h = setup({ execute: async () => {
    ran += 1
    return 'OK'
  } })
  // 带 agent:查的是 ('bash', exec.agent)
  await h.call(bashExec()).res
  assert.equal(h.gets[0]?.name, 'bash')
  assert.equal(h.gets[0]?.scope, 'a1')
  assert.equal(ran, 1)

  // 不带 agent → tools.get 返回 undefined → 原样,一次都不执行
  const before = ran
  const { res, nexted } = h.call(bashExec({ agent: undefined }))
  await res
  assert.equal(nexted(), true)
  assert.equal(ran, before)
})

test('无等价改写 → 原样(假 rtk 不存在)', async () => {
  const h = setup({ bin: join(tmpdir(), 'definitely-not-rtk') })
  const { res, nexted } = h.call(bashExec())
  await res
  assert.equal(nexted(), true)
})

test('执行抛错 → 转成 error envelope,不向外抛', async () => {
  const h = setup({ execute: async () => {
    throw new Error('boom')
  } })
  const out = await h.call(bashExec()).res
  assert.equal(out.isError, true)
  assert.match(out.error?.message ?? '', /boom/)
})
