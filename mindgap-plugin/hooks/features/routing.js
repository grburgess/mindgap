// F7 routing: pure helpers for compressing capture titles via in-mod haiku (called inline in capture.js).
export const PROMPT = 'Write one short title (max 80 chars) per numbered session capture candidate below. Output exactly one title per line, same order, no numbering.\n\n'

export const routingRequest = (nodes) => ({
  model: 'haiku',
  prompt: PROMPT + nodes.map((n, i) => `${i + 1}. ${n.body}`).join('\n'),
  effort: 'low',
  timeoutMs: 20000,
})

// Haiku titles when answered with exactly one line per node; else raw nodes (fallback).
export function applyRouting(nodes, r) {
  if (!r || !r.isAnswered) return { nodes, via: 'raw' }
  const titles = r.text.split('\n').map(s => s.trim()).filter(Boolean)
  if (titles.length !== nodes.length) return { nodes, via: 'raw' }
  return { nodes: nodes.map((n, i) => ({ ...n, title: titles[i].slice(0, 80) })), via: 'haiku' }
}

export function register(on, shared) {}
