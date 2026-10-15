/**
 * RTK 扩展器测试 —— node --test 直接跑。
 *
 * 覆盖:
 *   - rtk 缺失时 tryRewrite 无害放行(不抛、返回 rewritten:null)
 *   - getState 报运行时就绪状态(不报 enabled —— 开关归核心)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRtkExt, tryRewrite } from './rtk.ts'

test('rtk 缺失时 tryRewrite 无害放行', () => {
  const res = tryRewrite('git status', join(tmpdir(), 'definitely-not-rtk'))
  assert.equal(res.rewritten, null)
})

test('getState 只报运行时事实(ready/detail),不含 enabled', () => {
  const ext = createRtkExt()
  const st = ext.getState()
  assert.equal(typeof st.ready, 'boolean')
  // 开关归核心,插件不报也不存
  assert.equal('enabled' in st, false)
})

test('扩展器身份就绪,声明里不含 rewrite(核心不感知改写)', () => {
  const ext = createRtkExt()
  assert.equal(ext.id, 'rtk')
  assert.equal(ext.name, 'RTK')
  // 契约已剔除 rewrite:改命令是本插件私事,经 intercept.ts 自己拦截时用
  assert.equal('rewrite' in ext, false)
})
