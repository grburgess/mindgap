// activity feature: spinner suffix with graph counters + toast on MCP ingest/add_node.
// (capture flush and /todo toast inline where they ingest.)
import { shared as state } from '../shared.js'

const P = 'mcp__mindgap__mindgap_'

export const activityText = () =>
  ` · mindmap: ${state.counters.recalled} recalled · ${state.counters.ingested} ingested`

export function register(on, shared) {
  on('ui.render', { component: 'Spinner' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, suffix: activityText() } }))

  on('tool.call', { tool: P + 'ingest' }, async ($, e, next) => {
    const r = await next(e)
    if (!r?.isError) {
      state.counters.ingested += 1
      $.ui.toast(`mindmap: ingested (${state.counters.ingested} this session)`)
    }
    return r
  })
  on('tool.call', { tool: P + 'add_node' }, async ($, e, next) => {
    const r = await next(e)
    if (!r?.isError) {
      state.counters.ingested += 1
      $.ui.toast(`mindmap: ingested (${state.counters.ingested} this session)`)
    }
    return r
  })
}
