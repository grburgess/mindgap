// F2 liveview: band above prompt (open run phase + verdict counts); mirror AskUserQuestion to the run.
// No helper receives $: hooks call $ directly; helpers are pure.

export const runIds = stdout => stdout.split('\n').map(l => l.split('\t')[0]).filter(Boolean).slice(0, 5)
export const parseEvents = text => String(text).split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
export const isOpen = events => !events.some(ev => ev.kind === 'run.end')
const eventsPath = (home, id) => `${home}/.mindgap/runs/${id}/events.jsonl`

export function summarize(events) {
  let phase = null
  const verdicts = {}
  for (const ev of events) {
    if (ev.kind === 'phase.start' && ev.phase) phase = ev.phase
    if (ev.kind === 'verdict' && ev.data?.verdict) verdicts[ev.data.verdict] = (verdicts[ev.data.verdict] ?? 0) + 1
  }
  return { phase, verdicts }
}

export function register(on, shared) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await $.process.run(['mindgap', 'run', 'list'])
    if (list.exitCode !== 0) return next(e)
    const home = await $.env.get('HOME')
    let run = null
    for (const id of runIds(list.stdout)) {
      let text
      try { text = await $.fs.read(eventsPath(home, id)) } catch { continue }
      const events = parseEvents(text)
      if (isOpen(events)) { run = { id, events }; break }
    }
    if (!run) return next(e)
    const { phase, verdicts } = summarize(run.events)
    const counts = Object.entries(verdicts).map(([k, n]) => `${k} ${n}`).join(' · ')
    const { Box, Text } = $.ui.resolve(e)
    return h(Box, null, h(Text, { key: 'liveview', dimColor: true },
      `live ${run.id} · phase ${phase ?? '-'}${counts ? ' · ' + counts : ''}`))
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    try {
      const list = await $.process.run(['mindgap', 'run', 'list'])
      if (list.exitCode === 0) {
        const home = await $.env.get('HOME')
        for (const id of runIds(list.stdout)) {
          let text
          try { text = await $.fs.read(eventsPath(home, id)) } catch { continue }
          if (!isOpen(parseEvents(text))) continue
          await $.process.run(['mindgap', 'run', 'emit', id, 'question.ask', '--actor', 'claude', '--data', JSON.stringify({ questions: e.questions })])
          break
        }
      }
    } catch {}
    return next(e)
  })
}
