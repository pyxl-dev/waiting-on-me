import type { Register } from 'claude-code'

// Default sidebar section that holds sessions waiting on the user.
// Overridden by the `section` option.
const DEFAULT_SECTION = 'Waiting on you'
// Default Jev probability of "waiting" at or above which a session counts as
// waiting. Low on purpose: a false "waiting" costs less than a forgotten question.
const DEFAULT_JEV_THRESHOLD = 0.35

const IS_WAITING = { plugin: 'waiting-on-me', key: 'isWaiting' } as const
const ORIGIN = { plugin: 'waiting-on-me', key: 'origin' } as const

type Signal = 'waiting' | 'done' | undefined

export const register: Register = (on, options) => {
  const section = typeof options.section === 'string' && options.section.trim() !== '' ? options.section.trim() : DEFAULT_SECTION
  const useJev = options.useJev !== false
  const threshold = typeof options.jevThreshold === 'number' ? options.jevThreshold : DEFAULT_JEV_THRESHOLD

  // Claude's own signal for the current main-loop turn, from its wrap_up call.
  let signal: Signal

  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, ($, e, next) => {
    if (!e.agentId) {
      const args = e as unknown as { blocked?: boolean; ask?: string }
      signal = args.blocked === true || (typeof args.ask === 'string' && args.ask.trim() !== '') ? 'waiting' : 'done'
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId) return res
    const claudeSignal = signal
    signal = undefined
    if (e.isAborted || e.reason !== 'answer') return res

    const parse = (r: any) => {
      try { return JSON.parse(r?.content?.[0]?.text ?? 'null') } catch { return null }
    }
    const call = (tool: string, args: Record<string, unknown>) => $.mcp.call('ccd_sidebar', tool, args)

    // Optional fallback: classify the final text with the `jev` CLI when it is
    // installed. Without it, only Claude's wrap_up signal decides.
    const askJev = async (answer: string): Promise<boolean | undefined> => {
      if (!useJev) return undefined
      const payload = {
        state: answer.slice(-4000),
        questions: {
          waiting: {
            type: 'noul',
            instructions: 'This is the final message of an AI coding assistant to its user. Does it end waiting on the user: a question, a choice to make, or an action the user must do and report back?',
            criteria: {
              true: 'the user must answer, decide, or act and come back',
              false: 'the task is finished, nothing pending from the user',
            },
          },
        },
      }
      const run = await $.process
        .run(['/bin/zsh', '-lc', 'command -v jev >/dev/null || exit 127; jev ask --raw'], {
          stdin: JSON.stringify(payload),
          timeoutMs: 20000,
        })
        .catch(() => null)
      if (!run || run.exitCode !== 0) return undefined
      const p = (() => { try { return JSON.parse(run.stdout) } catch { return null } })()
      const prob = p?.answers?.waiting?.noul
      return typeof prob === 'number' ? prob >= threshold : undefined
    }

    try {
      let isWaitingNow: boolean | undefined
      if (claudeSignal) isWaitingNow = claudeSignal === 'waiting'
      else if (e.answer.trim() !== '') isWaitingNow = await askJev(e.answer)
      if (isWaitingNow === undefined) return res

      // Where the session really is: the user may have moved it by hand, or a
      // previous version filed it. Falls back to the stored flag.
      const me = parse(await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' }).catch(() => null))
      const secs = (parse(await call('list_sections', {})) ?? []) as Array<{ id: string; kind: string; name: string }>
      let id = secs.find(x => x.kind === 'manual' && x.name === section)?.id
      const { value: stored = false } = await $.state.get(IS_WAITING)
      const groupId: string | undefined = me ? (me.group?.id ?? 'sessions') : undefined
      const wasWaiting = groupId !== undefined && id !== undefined ? groupId === id : stored
      if (isWaitingNow === wasWaiting) return res

      if (isWaitingNow) {
        if (!id) id = parse(await call('create_section', { name: section }))?.id
        if (!id) return res
        await $.state.set(ORIGIN, groupId ?? 'sessions')
        await call('move_sessions', { session_ids: ['self'], section_id: id })
        await $.state.set(IS_WAITING, true)
      } else {
        const { value: origin = 'sessions' } = await $.state.get(ORIGIN)
        const moved = await call('move_sessions', { session_ids: ['self'], section_id: origin })
        if ((moved as any)?.isError) await call('move_sessions', { session_ids: ['self'], section_id: 'sessions' })
        await $.state.set(IS_WAITING, false)
      }
    } catch (err) {
      $.ui.toast(`waiting-on-me: ${String(err).slice(0, 160)}`)
    }
    return res
  })
}
