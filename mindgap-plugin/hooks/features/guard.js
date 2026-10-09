// guard feature (F6): confirm destructive mindgap MCP calls via $.ui.ask.
const P = 'mcp__mindgap__mindgap_'
const OK = 'Confirm', NO = 'Cancel'

export const needsConfirm = e =>
  e.tool === P + 'remove_node' ||
  ((e.tool === P + 'ingest' || e.tool === P + 'add_node') && e.replace === true)

export function register(on, shared) {
  on('tool.call', async ($, e, next) => {
    if (!needsConfirm(e)) return next(e)
    const what = e.tool.slice(P.length) + (e.id ? ` ${e.id}` : '')
    let answer
    try { answer = await $.ui.ask(`Allow destructive mindgap ${what}?`, [OK, NO]) } catch { answer = NO }
    return answer === OK ? next(e) : { deny: `mindgap guard: user cancelled ${what}` }
  })
}
