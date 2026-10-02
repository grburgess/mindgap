import { test, expect } from 'claude-code/testing'

function stub(on: any, calls: string[][], stdout = 'n1') {
  on('process.run', async (_$: any, e: any) => { calls.push([...e.argv]); return { value: { exitCode: 0, stdout, stderr: '' } } })
}

test('/todo ingests open todo node and toasts', async ($, on) => {
  const calls: string[][] = []; const toasts: string[] = []
  stub(on, calls, 'todo-x')
  on('ui.toast', async (_$: any, e: any) => { toasts.push(e.text); return { value: undefined } as any })
  const r: any = await $.command.run({ command: 'todo', args: 'fix the thing' } as any)
  expect(calls).toEqual([['mindgap', 'add', '--title', 'fix the thing', '--type', 'todo', '--tags', 'status:open', '--by', 'mod:todo']])
  expect(r.text).toBe('todo added: todo-x')
  expect(toasts[0]).toMatch(/ingested todo \(1 this session\)/)
})

test('/todo without text shows usage, no CLI call', async ($, on) => {
  const calls: string[][] = []
  stub(on, calls)
  const r: any = await $.command.run({ command: 'todo', args: '  ' } as any)
  expect(r.text).toBe('usage: /todo <text>')
  expect(calls).toEqual([])
})

test('/mm find returns CLI stdout', async ($, on) => {
  const calls: string[][] = []
  stub(on, calls, 'a  Alpha\nb  Beta\n')
  const r: any = await $.command.run({ command: 'mm', args: 'find roof seg' } as any)
  expect(calls).toEqual([['mindgap', 'find', 'roof seg']])
  expect(r.text).toBe('a  Alpha\nb  Beta')
})

test('/mm flush with empty queue answers without CLI', async ($, on) => {
  const calls: string[][] = []
  stub(on, calls)
  const r: any = await $.command.run({ command: 'mm', args: 'flush' } as any)
  expect(r.text).toBe('flushed: 0')
  expect(calls).toEqual([])
})

test('/mm unknown sub shows usage', async ($, on) => {
  stub(on, [])
  const r: any = await $.command.run({ command: 'mm', args: 'nope' } as any)
  expect(r.text).toBe('usage: /mm find <q> | /mm flush')
})
