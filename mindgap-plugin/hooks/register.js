import { shared } from './shared.js'
import { register as recall } from './features/recall.js'
import { register as liveview } from './features/liveview.js'
import { register as capture } from './features/capture.js'
import { register as commands } from './features/commands.js'
import { register as activity } from './features/activity.js'
import { register as guard } from './features/guard.js'
import { register as routing } from './features/routing.js'

export const register = (on, options) => {
  recall(on, shared)
  liveview(on, shared)
  capture(on, shared)
  commands(on, shared)
  activity(on, shared)
  guard(on, shared)
  routing(on, shared)
}
