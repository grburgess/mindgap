// capture feature: collect turn answers as candidates; flush them to the graph via `mindgap ingest -`
// on /mm flush, SessionEnd and PreCompact. Titles compressed by haiku (routing.js), raw on fallback.
import { routingRequest, applyRouting } from './routing.js'

const BY = 'mod:capture'
const ARGV = ['mindgap', 'ingest', '--by', BY, '-']
const summarize = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 80)

export function collectCandidate(shared, e) {
  if (e.agentId || e.reason !== 'answer' || !e.answer?.trim()) return
  shared.captureCandidates.push({
    id: `capture-${e.turnId}`,
    title: summarize(e.answer),
    body: e.answer,
    type: 'capture',
    confidence: 0.5,
    created_by: BY,
  })
}

// After the CLI call: requeue on failure, count on success.
function settle(shared, nodes, r) {
  if (r.exitCode !== 0) { shared.captureCandidates.unshift(...nodes); return { flushed: 0, error: r.stderr } }
  shared.counters.ingested += nodes.length
  return { flushed: nodes.length }
}

export function register(on, shared) {
  on('turn.complete', async ($, e, next) => { collectCandidate(shared, e); return next(e) })

  // Idempotent: queue emptied before the CLI call; empty queue -> no call.
  on('classic.SessionEnd', async ($, e, next) => {
    const raw = shared.captureCandidates.splice(0)
    if (raw.length) {
      let routed
      try { routed = await $.model.complete(routingRequest(raw)) } catch { routed = undefined }
      const { nodes } = applyRouting(raw, routed)
      const out = settle(shared, raw, await $.process.run(ARGV, { stdin: JSON.stringify({ nodes }) }))
      if (out.flushed) $.ui.toast(`mindmap: ingested ${out.flushed} (${shared.counters.ingested} this session)`)
    }
    return next(e)
  })
  on('classic.PreCompact', async ($, e, next) => {
    const raw = shared.captureCandidates.splice(0)
    if (raw.length) {
      let routed
      try { routed = await $.model.complete(routingRequest(raw)) } catch { routed = undefined }
      const { nodes } = applyRouting(raw, routed)
      const out = settle(shared, raw, await $.process.run(ARGV, { stdin: JSON.stringify({ nodes }) }))
      if (out.flushed) $.ui.toast(`mindmap: ingested ${out.flushed} (${shared.counters.ingested} this session)`)
    }
    return next(e)
  })

  on('command.run', { command: 'mm' }, async ($, e, next) => {
    if ((e.args || '').trim().split(/\s+/)[0] !== 'flush') return next(e)
    const raw = shared.captureCandidates.splice(0)
    if (!raw.length) return { text: 'flushed: 0' }
    let routed
    try { routed = await $.model.complete(routingRequest(raw)) } catch { routed = undefined }
    const { nodes, via } = applyRouting(raw, routed)
    const out = settle(shared, raw, await $.process.run(ARGV, { stdin: JSON.stringify({ nodes }) }))
    if (out.flushed) $.ui.toast(`mindmap: ingested ${out.flushed} (${shared.counters.ingested} this session)`)
    return { text: out.flushed ? `flushed: ${out.flushed} (${via})` : `flush failed: ${out.error || 'unknown'}` }
  })
}
