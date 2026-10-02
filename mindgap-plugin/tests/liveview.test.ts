import { test, expect } from 'claude-code/testing'

const RUN = '20261002-115239-loop-system'
const EVENTS = [
  { kind: 'run.start', phase: null, data: {} },
  { kind: 'phase.start', phase: '1.1 make', data: {} },
  { kind: 'verdict', phase: null, data: { verdict: 'PASS' } },
  { kind: 'verdict', phase: null, data: { verdict: 'PASS' } },
  { kind: 'verdict', phase: null, data: { verdict: 'FAIL' } },
].map(x => JSON.stringify(x)).join('\n')

function stubs(on: any, runs: string[][]) {
  on('env.get', async () => ({ value: '/home/t' }))
  on('fs.read', async (_$: any, e: any) => {
    if (e.path === `/home/t/.mindgap/runs/${RUN}/events.jsonl`) return { value: EVENTS }
    throw new Error('missing ' + e.path)
  })
  on('process.run', async (_$: any, e: any) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[2] === 'list' ? `${RUN}\tloop-system\tx\n` : '', stderr: '' } }
  })
}

test('band mount shows stubbed phase + verdict counts', async ($, on) => {
  stubs(on, [])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mindgap', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as any })
    const el = await ui.find({ type: 'Text', text: /^live / })
    expect(el?.text).toContain('phase 1.1 make')
    expect(el?.text).toContain('PASS 2')
    expect(el?.text).toContain('FAIL 1')
    await ui.unmount()
  }
})

test('AskUserQuestion tool.call emits question.ask and passes result through', async ($, on) => {
  const runs: string[][] = []
  stubs(on, runs)
  const answer = { result: { answers: { q: 'a' } }, isError: false }
  on('tool.call', { tool: 'AskUserQuestion' }, async () => answer as any)
  const questions = [{ question: 'Pick?', header: 'h', multiSelect: false, options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'd' }] }]
  const r: any = await $.tool.call({ tool: 'AskUserQuestion', questions } as any)
  const emit = runs.find(a => a[2] === 'emit')
  expect(emit?.slice(0, 5)).toEqual(['mindgap', 'run', 'emit', RUN, 'question.ask'])
  expect(JSON.parse(emit![emit!.indexOf('--data') + 1])).toEqual({ questions })
  expect(r.result).toEqual(answer.result)
})
