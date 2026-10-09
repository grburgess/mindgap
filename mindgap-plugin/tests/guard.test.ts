import { test, expect } from 'claude-code/testing'

const P = 'mcp__mindgap__mindgap_'

// answer: label to pick in the AskUserQuestion dialog, or null to dismiss.
function setup(on: any, answer: string | null) {
  const asked: any[] = []; const downstream: any[] = []
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: any, e: any) => {
    asked.push(e.questions[0].question)
    if (answer === null) return { result: 'dismissed', isError: true } as any
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } }, isError: false } as any
  })
  for (const t of ['remove_node', 'ingest', 'add_node', 'find'])
    on('tool.call', { tool: P + t }, async (_$: any, e: any) => { downstream.push(e); return { result: 'ran', isError: false } as any })
  return { asked, downstream }
}

test('cancel denies remove_node; downstream not hit', async ($, on) => {
  const s = setup(on, 'Cancel')
  const r: any = await $.tool.call({ tool: P + 'remove_node', id: 'n1' } as any)
  expect(s.asked.length).toBe(1)
  expect(s.asked[0]).toContain('remove_node n1')
  expect(s.downstream).toEqual([])
  expect(JSON.stringify(r)).toContain('mindgap guard: user cancelled')
})

test('dismissed ask denies replace:true ingest', async ($, on) => {
  const s = setup(on, null)
  const r: any = await $.tool.call({ tool: P + 'ingest', replace: true, created_by: 'x' } as any)
  expect(s.downstream).toEqual([])
  expect(JSON.stringify(r)).toContain('mindgap guard: user cancelled')
})

test('confirm passes replace:true add_node downstream', async ($, on) => {
  const s = setup(on, 'Confirm')
  const r: any = await $.tool.call({ tool: P + 'add_node', replace: true, title: 't', created_by: 'x' } as any)
  expect(s.asked.length).toBe(1)
  expect(s.downstream.length).toBe(1)
  expect(r.result).toBe('ran')
})

test('non-destructive calls pass without asking', async ($, on) => {
  const s = setup(on, 'Cancel')
  await $.tool.call({ tool: P + 'add_node', title: 't', created_by: 'x' } as any)
  await $.tool.call({ tool: P + 'find', query: 'x' } as any)
  expect(s.asked).toEqual([])
  expect(s.downstream.length).toBe(2)
})
