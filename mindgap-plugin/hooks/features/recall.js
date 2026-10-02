// F1 recall pane: run `mindgap find <terms> --json` on session start and
// each prompt, list recalled nodes in a pane, each droppable.


const PANE = 'cape-recall'
const MAX = 10

// Query terms: first few words >= 4 chars.
export const terms = text =>
  (text.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? []).slice(0, 3).join(' ')

// Pure: new rows from `find --json` stdout not already recalled; null when nothing new.
export function freshRows(shared, stdout) {
  let rows
  try { rows = JSON.parse(stdout) } catch { return null }
  const seen = new Set(shared.recalled.map(n => n.id))
  const fresh = rows.filter(n => !seen.has(n.id)).slice(0, MAX)
  return fresh.length ? fresh.map(n => ({ id: n.id, title: n.title })) : null
}

export function register(on, shared) {
  shared.recalled ??= []

  on('session.start', { isInteractive: true }, async ($, e, next) => {
    try {
      const r = await $.process.run(['mindgap', 'find', 'project', '--json'])
      const fresh = r.exitCode === 0 ? freshRows(shared, r.stdout) : null
      if (fresh) {
        shared.recalled = [...shared.recalled, ...fresh]
        shared.counters.recalled += fresh.length
        $.ui.invalidate('ui.render')
        $.ui.open({ id: PANE, title: 'Recall' }).catch(() => {})
      }
    } catch {}
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const q = terms(e.text)
    if (q) {
      const r = await $.process.run(['mindgap', 'find', q, '--json'])
      const fresh = r.exitCode === 0 ? freshRows(shared, r.stdout) : null
      if (fresh) {
        shared.recalled = [...shared.recalled, ...fresh]
        shared.counters.recalled += fresh.length
        $.ui.invalidate('ui.render')
        $.ui.open({ id: PANE, title: 'Recall' }).catch(() => {})
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return h(Box, { flexDirection: 'column' },
      shared.recalled.length === 0 && h(Text, { dimColor: true }, 'Nothing recalled.'),
      ...shared.recalled.map(n =>
        h(Box, { flexDirection: 'row', gap: 1 },
          h(Text, { dimColor: true }, n.id),
          h(Text, null, n.title),
          h(Button, {
            key: `drop-${n.id}`,
            label: 'drop',
            onPress: () => {
              shared.recalled = shared.recalled.filter(x => x.id !== n.id)
              $.ui.invalidate('ui.render')
            },
          }),
        )),
    )
  })
}
