import { test, expect } from 'claude-code/testing'
import { terms } from '../hooks/features/recall.js'

const NODE = { id: 'n-stub', title: 'Stubbed recall node' }
const SURFACES = ['terminal', 'desktop'] as const

// Answer the engine beneath the plugin: CLI returns one node, prompt and pane pass.
const stubEngine = (on: any, calls: string[][]) => {
  on('process.run', async (_$: any, e: any) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify([NODE]), stderr: '' } }
  })
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

const mountPane = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'mindgap', surface, component: 'Pane', requestId: 'cape-recall', props: { title: 'Recall' } })

test('terms keeps first three long words', () => {
  expect(terms('Fix the Mindmap recall pane quickly')).toBe('mindmap recall pane')
})

test('prompt recall runs mindgap find and pane lists node', async ($, on) => {
  const calls: string[][] = []
  stubEngine(on, calls)
  await $.prompt.submit({ text: 'mindmap recall pane' })
  expect(calls).toContainEqual(['mindgap', 'find', 'mindmap recall pane', '--json'])
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /Stubbed recall node/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /n-stub/ })).toBeDefined()
    await ui.unmount()
  }
})

test('press drop removes node from pane', async ($, on) => {
  stubEngine(on, [])
  await $.prompt.submit({ text: 'mindmap recall pane' })
  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Stubbed recall node/ })).toBeDefined()
  await ui.press({ key: 'drop-n-stub' })
  expect(await ui.find({ type: 'Text', text: /Stubbed recall node/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Nothing recalled/ })).toBeDefined()
  await ui.unmount()
})
