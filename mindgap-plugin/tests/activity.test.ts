import { test, expect } from 'claude-code/testing'

const PROPS = { word: 'Sauteing', message: null, suffix: '…', mode: 'responding' } as any
const P = 'mcp__mindgap__mindgap_'

test('MCP ingest toasts, bumps spinner counter; errored call does not', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', async (_$: any, e: any) => { toasts.push(e.text); return { value: undefined } as any })
  on('ui.render', { component: 'Spinner' }, async ($$: any, e: any) => { const { Text } = $$.ui.resolve(e); return h(Text, null, e.props.suffix) })
  let fail = false
  on('tool.call', { tool: P + 'ingest' }, async () => ({ result: 'ok', isError: fail }) as any)
  await $.tool.call({ tool: P + 'ingest', created_by: 'x' } as any)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/mindmap: ingested \(1 this session\)/)
  fail = true
  await $.tool.call({ tool: P + 'ingest', created_by: 'x' } as any)
  expect(toasts).toHaveLength(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mindgap', surface, component: 'Spinner', props: PROPS })
    expect(await ui.find({ text: /mindmap: 0 recalled · 1 ingested/ })).toBeDefined()
    await ui.unmount()
  }
})
