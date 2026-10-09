import { test, expect } from 'claude-code/testing'

const turn = (n: number) => ({ reason: 'answer', answer: `answer ${n}  text`, turnId: `t${n}`, durationMs: 1, isAborted: false }) as any

function stubs(on: any, calls: any[], { exitCode = 0, model = { isAnswered: false, reason: 'api-error' } as any } = {}) {
  on('process.run', async (_$: any, e: any) => { calls.push({ argv: [...e.argv], stdin: e.init?.stdin }); return { value: { exitCode, stdout: '', stderr: exitCode ? 'boom' : '' } } })
  on('model.complete', async () => ({ value: model }))
  on('turn.complete', async () => ({ text: '' }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('classic.SessionEnd', async () => ({}) as any)
  on('classic.PreCompact', async () => ({}) as any)
}
const ingests = (calls: any[]) => calls.filter(c => c.argv[1] === 'ingest')

test('3 turn.complete then /mm flush ingests 3 candidates in one call; second flush no call', async ($, on) => {
  const calls: any[] = []
  stubs(on, calls)
  for (const n of [1, 2, 3]) await $.turn.complete(turn(n))
  const r: any = await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(ingests(calls).length).toBe(1)
  expect(ingests(calls)[0].argv).toEqual(['mindgap', 'ingest', '--by', 'mod:capture', '-'])
  const payload = JSON.parse(ingests(calls)[0].stdin)
  expect(payload.nodes.map((x: any) => x.id)).toEqual(['capture-t1', 'capture-t2', 'capture-t3'])
  expect(payload.nodes[0].title).toBe('answer 1 text')
  expect(r.text).toBe('flushed: 3 (raw)')
  const r2: any = await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(ingests(calls).length).toBe(1)
  expect(r2.text).toBe('flushed: 0')
})

test('haiku titles used when model answers one line per node', async ($, on) => {
  const calls: any[] = []
  stubs(on, calls, { model: { isAnswered: true, text: 'Title A\nTitle B\n', usage: {} } })
  await $.turn.complete(turn(1)); await $.turn.complete(turn(2))
  const r: any = await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(JSON.parse(ingests(calls)[0].stdin).nodes.map((n: any) => n.title)).toEqual(['Title A', 'Title B'])
  expect(r.text).toBe('flushed: 2 (haiku)')
})

test('subagent and non-answer turns are skipped; SessionEnd with empty queue makes no call', async ($, on) => {
  const calls: any[] = []
  stubs(on, calls)
  await $.turn.complete({ ...turn(1), agentId: 'a1' })
  await $.turn.complete({ ...turn(2), reason: 'aborted' })
  await $.classic.SessionEnd({ reason: 'other' } as any)
  expect(ingests(calls)).toEqual([])
})

test('SessionEnd and PreCompact flush; failed ingest requeues', async ($, on) => {
  const calls: any[] = []
  stubs(on, calls, { exitCode: 1 })
  await $.turn.complete(turn(1))
  await $.classic.SessionEnd({ reason: 'other' } as any)
  expect(ingests(calls).length).toBe(1)
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null } as any)
  expect(ingests(calls).length).toBe(2)
  expect(JSON.parse(ingests(calls)[1].stdin).nodes[0].id).toBe('capture-t1')
})
