// commands feature: /todo <text>, /mm find <q>, /mm recall, /mm flush. No Claude turn.
import { PANE } from './recall.js'

export function register(on, shared) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todo', description: 'Add an open todo to mindgap' })
    await $.command.register({ name: 'mm', description: 'mindgap: find <q> | recall | flush' })
    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = (e.args || '').trim()
    if (!text) return { text: 'usage: /todo <text>' }
    const r = await $.process.run(['mindgap', 'add', '--title', text, '--type', 'todo', '--tags', 'status:open', '--by', 'mod:todo'])
    if (r.exitCode !== 0) return { text: `todo failed: ${r.stderr || r.stdout}` }
    shared.counters.ingested += 1
    $.ui.toast(`mindmap: ingested todo (${shared.counters.ingested} this session)`)
    return { text: `todo added: ${(r.stdout || '').trim()}` }
  })

  on('command.run', { command: 'mm' }, async ($, e, next) => {
    const [sub, ...rest] = (e.args || '').trim().split(/\s+/)
    if (sub === 'find' && rest.length) {
      const r = await $.process.run(['mindgap', 'find', rest.join(' ')])
      return { text: r.exitCode === 0 ? (r.stdout || '').trim() || 'no matches' : `find failed: ${r.stderr || r.stdout}` }
    }
    if (sub === 'recall') {
      await $.ui.open({ id: PANE, title: 'Recall' })
      return { text: `recall pane: ${shared.recalled.length} node(s)` }
    }
    if (sub === 'flush') {
      return next(e) // answered by capture.js's /mm flush hook
    }
    return { text: 'usage: /mm find <q> | /mm recall | /mm flush' }
  })
}
