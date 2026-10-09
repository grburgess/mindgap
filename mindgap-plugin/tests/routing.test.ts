import { test, expect } from 'claude-code/testing'

const turn = { reason: 'answer', answer: 'raw answer', turnId: 'r1', durationMs: 1, isAborted: false } as any

test('flush asks haiku at low effort with candidate bodies', async ($, on) => {
  const asks: any[] = []
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('model.complete', async (_$: any, e: any) => { asks.push(e); return { value: { isAnswered: true, text: 'T', usage: {} } } })
  on('turn.complete', async () => ({ text: '' }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await $.turn.complete(turn)
  await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(asks.length).toBe(1)
  expect(asks[0].model).toBe('haiku')
  expect(asks[0].effort).toBe('low')
  expect(asks[0].prompt).toContain('1. raw answer')
})

test('model failure falls back to raw titles and still ingests', async ($, on) => {
  const stdins: string[] = []
  on('process.run', async (_$: any, e: any) => { stdins.push(e.init?.stdin); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('model.complete', async () => { throw new Error('down') })
  on('turn.complete', async () => ({ text: '' }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  await $.turn.complete(turn)
  const r: any = await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(r.text).toBe('flushed: 1 (raw)')
  expect(JSON.parse(stdins[0]).nodes[0].title).toBe('raw answer')
})
