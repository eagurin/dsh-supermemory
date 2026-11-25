#!/usr/bin/env node
/**
 * Interactive setup for the Supermemory bundle.
 *
 * It asks which server the memory should live on — a self-hosted local server or
 * Supermemory Cloud — probes the local one instead of assuming, and prints the
 * complete Loader row to paste into the profile patch. Nothing is written: the
 * row is configuration the operator applies, and the API key is never asked for
 * here (it belongs in the credential store).
 *
 * Usage:
 *   node scripts/setup.mjs                 # asks, probes 127.0.0.1:6767
 *   node scripts/setup.mjs --json          # machine-readable plan, no prompts
 *   node scripts/setup.mjs --mode cloud --base-url https://api.supermemory.ai
 *   node scripts/setup.mjs --mode local --container dsh --read-containers hermes_default,hermes
 *
 * Exit codes: 0 success, 2 bad flags, 3 nothing to do (no local server and no
 * explicit mode).
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, env, exit } from 'node:process'
import { pathToFileURL } from 'node:url'
import { internals } from '../index.js'

const LOCAL_DEFAULT = 'http://127.0.0.1:6767'
const CLOUD_DEFAULT = 'https://api.supermemory.ai'

/** Parse `--flag value` pairs; booleans stand alone. */
function parseFlags(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const [name, inline] = token.slice(2).split('=')
    if (inline !== undefined) {
      flags[name] = inline
      continue
    }
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) flags[name] = true
    else {
      flags[name] = next
      index += 1
    }
  }
  return flags
}

/** Probe one health endpoint; returns true only on HTTP 200 with status ok. */
export async function reachable(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v3/health`, { signal: controller.signal })
    if (!response.ok) return false
    const text = await response.text()
    return /"status"\s*:\s*"ok"/.test(text) || response.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function ask(rl, question, fallback) {
  const suffix = fallback ? ` [${fallback}]` : ''
  return rl.question(`${question}${suffix}: `).then(answer => (answer.trim() || fallback || ''))
}

/** Render the complete Loader row; an override replaces the whole config. */
function renderRow(config) {
  const lines = [`- id: supermemory`, `  name: '@local/dsh-supermemory'`, `  config:`]
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`    ${key}: []`)
      else {
        lines.push(`    ${key}:`)
        for (const item of value) lines.push(`      - ${item}`)
      }
      continue
    }
    if (typeof value === 'string') lines.push(`    ${key}: ${value === '' ? "''" : value}`)
    else lines.push(`    ${key}: ${value}`)
  }
  return lines.join('\n')
}

/**
 * Turn the operator's choices into a complete Loader row plus warnings.
 * Pure: no prompts, no network, so the unit tests can cover every branch.
 * @param {{mode: 'local' | 'cloud', baseUrl?: string, keyRef?: string, container?: string, readContainers?: string[], localUp?: boolean, localUrl?: string}} choices - resolved answers.
 * @returns {{mode: string, baseUrl: string, container: string, readContainers: string[], apiKeyRef: string, localServerDetected: boolean, warnings: string[], row: string}} the plan.
 */
export function buildPlan(choices) {
  const { mode } = choices
  if (mode !== 'local' && mode !== 'cloud') {
    throw new Error(`mode must be "local" or "cloud", got ${JSON.stringify(mode)}`)
  }
  const localUrl = choices.localUrl ?? LOCAL_DEFAULT
  const baseUrl = choices.baseUrl ?? (mode === 'cloud' ? CLOUD_DEFAULT : localUrl)
  const keyRef = choices.keyRef ?? internals.DEFAULTS.apiKeyRef
  const container = choices.container ?? internals.DEFAULTS.container
  const readContainers = choices.readContainers ?? internals.DEFAULTS.readContainers
  const localUp = choices.localUp === true

  if (!/^https?:\/\/[^\s]+$/i.test(String(baseUrl))) {
    throw new Error(`${baseUrl} is not an http(s) URL`)
  }
  const config = { ...internals.DEFAULTS, baseUrl, apiKeyRef: keyRef, container, readContainers }
  // Reject typos and impossible values before anyone pastes this into a profile.
  const resolved = internals.resolveSettings(config)
  if (resolved.baseUrl !== String(baseUrl).replace(/\/+$/, '')) {
    throw new Error(`${baseUrl} is not a usable base URL`)
  }

  return {
    mode,
    baseUrl: resolved.baseUrl,
    container: resolved.container,
    readContainers: resolved.readContainers,
    apiKeyRef: resolved.apiKeyRef,
    localServerDetected: localUp,
    warnings: [
      ...(mode === 'local' && !localUp ? [`no server is answering ${localUrl}; start it with \`npx supermemory local\` or the memory will report errors per turn`] : []),
      ...(mode === 'cloud' ? ['with the cloud server the captured transcripts leave this machine'] : []),
      'an override replaces the whole config, so paste every key below',
    ],
    row: renderRow(config),
  }
}

async function main() {
  const flags = parseFlags(argv.slice(2))
  const json = flags.json === true
  const localUrl = typeof flags['local-url'] === 'string' ? flags['local-url'] : (env.SUPERMEMORY_LOCAL_URL || LOCAL_DEFAULT)

  const probing = flags['no-probe'] !== true
  // The local server restarts on its own schedule (launchd, keepalive), so a
  // single failed probe would be a false negative: retry before declaring it down.
  let localUp = false
  if (probing) {
    for (let attempt = 0; attempt < 3 && !localUp; attempt += 1) {
      localUp = await reachable(localUrl)
      if (!localUp) await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  let mode = typeof flags.mode === 'string' ? flags.mode : undefined
  if (mode !== undefined && mode !== 'local' && mode !== 'cloud') {
    console.error(`setup: --mode must be "local" or "cloud", got ${JSON.stringify(mode)}`)
    exit(2)
  }

  // No mode and no local server: never silently pick the cloud. Ask, and in JSON
  // mode say plainly that a decision is required.
  if (mode === undefined && !localUp) {
    if (json) {
      console.error(JSON.stringify({
        needDecision: true,
        reason: `no local Supermemory server answered /v3/health at ${localUrl}`,
        options: [
          { mode: 'local', baseUrl: localUrl, hint: 'start it with `npx supermemory local`' },
          { mode: 'cloud', baseUrl: CLOUD_DEFAULT, hint: 'needs an API key from https://console.supermemory.ai' },
        ],
      }, null, 2))
      exit(3)
    }
  }

  // Prompts need a real terminal: with a piped stdin every question resolves on
  // EOF, the event loop empties, and Node exits 0 without printing a plan. Ask
  // for flags instead of failing silently.
  const tty = stdin.isTTY === true
  if (!json && typeof flags.mode !== 'string' && !tty) {
    console.error('setup: no terminal to ask questions in; pass --mode local or --mode cloud (or --json)')
    exit(3)
  }
  const interactive = !json && tty && (typeof flags.mode !== 'string' || flags['ask'] === true)
  let rl
  if (interactive) rl = createInterface({ input: stdin, output: stdout })

  try {
    if (mode === undefined) {
      if (json) {
        // Machine-readable mode must not prompt: a reachable local server is the
        // documented default, and a missing one already exited above.
        mode = 'local'
      } else {
        console.log(`Supermemory setup\n\n  local server : ${localUp ? 'reachable' : 'not reachable'} at ${localUrl}`)
        console.log(`  cloud        : ${CLOUD_DEFAULT}\n`)
        const answer = (await ask(rl, 'Where should the memory live — local or cloud?', localUp ? 'local' : '')) || ''
        if (!answer) {
          console.error('setup: a choice is required (local or cloud).')
          exit(3)
        }
        mode = answer.toLowerCase().startsWith('c') ? 'cloud' : 'local'
      }
    }

    const baseUrlDefault = mode === 'cloud' ? CLOUD_DEFAULT : localUrl
    const baseUrl = typeof flags['base-url'] === 'string'
      ? flags['base-url']
      : (interactive ? await ask(rl, 'Server URL', baseUrlDefault) : baseUrlDefault)
    const keyRef = typeof flags['key-ref'] === 'string'
      ? flags['key-ref']
      : (interactive ? await ask(rl, 'Credential reference for the API key', internals.DEFAULTS.apiKeyRef) : internals.DEFAULTS.apiKeyRef)
    const container = typeof flags.container === 'string'
      ? flags.container
      : (interactive ? await ask(rl, 'Own namespace (write target)', internals.DEFAULTS.container) : internals.DEFAULTS.container)
    const reads = typeof flags['read-containers'] === 'string'
      ? flags['read-containers'].split(',').map(item => item.trim()).filter(Boolean)
      : internals.DEFAULTS.readContainers

    let plan
    try {
      plan = buildPlan({ mode, baseUrl, keyRef, container, readContainers: reads, localUp, localUrl })
    } catch (error) {
      console.error(`setup: ${error instanceof Error ? error.message : String(error)}`)
      exit(2)
    }

    if (json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }

    console.log('\n== Loader row for the profile patch ==\n')
    console.log(row)
    console.log('\n== Next steps ==\n')
    console.log(`  1. Put the API key into the DSH credential store under ${plan.apiKeyRef}`)
    console.log(`     ${mode === 'cloud' ? '(from https://console.supermemory.ai)' : '(local: cat ~/.supermemory/api-key)'}`)
    console.log('  2. Paste the row above into ~/.dsh/profiles/<profile>/cordis.patch.yml')
    console.log('  3. Restart the app and check: supermemory_namespaces, then supermemory_search')
    for (const warning of plan.warnings) console.log(`\n  ! ${warning}`)
  } finally {
    if (rl) rl.close()
  }
}

// Importing this module (tests, tooling) must not run the CLI.
const invokedDirectly = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href
if (invokedDirectly) {
  main().catch(error => {
    console.error(`setup: ${error instanceof Error ? error.message : String(error)}`)
    exit(1)
  })
}
