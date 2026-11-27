import { apply } from '../index.js'

/**
 * Minimal Host stand-in: captures the registered tools, hooks and prompt sections,
 * and stubs fetch so a test never touches a real Supermemory server.
 *
 * @param {{config?: object, fetchHandler?: Function, realNetwork?: boolean, apiKey?: string}} [options] - row config, a
 *   fetch stub `(url, init) => { status, body }`, or real network access with a live key for the
 *   gated live suite.
 * @returns {Promise<{tools: Map<string, object>, handlers: Array<{name: string, handler: Function}>, sections: object[], calls: Array<object>, restore: Function}>} the mock host.
 */
export async function createHost(options = {}) {
  const tools = new Map()
  const handlers = []
  const sections = []
  const calls = []

  const ctx = {
    tools: { register: spec => tools.set(spec.name, spec) },
    systemPrompt: { section: spec => sections.push(spec) },
    effect: fn => fn(),
    get: () => undefined,
    on: (name, handler) => handlers.push({ name, handler }),
    credentials: { resolve: async () => ({ value: options.apiKey ?? 'test-key' }) },
    logger: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
  }

  const originalFetch = globalThis.fetch
  if (options.realNetwork !== true) {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
      if (options.fetchHandler) {
        const result = await options.fetchHandler(String(url), init)
        if (result) {
          return {
            ok: (result.status ?? 200) < 400,
            status: result.status ?? 200,
            text: async () => (typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {})),
          }
        }
      }
      return { ok: true, status: 200, text: async () => '{}' }
    }
  }

  apply(ctx, options.config ?? {})

  return {
    tools,
    handlers,
    sections,
    calls,
    restore: () => { globalThis.fetch = originalFetch },
  }
}

/** Find a captured hook by event name. */
export function hook(host, name) {
  return host.handlers.find(entry => entry.name === name)
}
