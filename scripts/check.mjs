/**
 * Repository checks that need no dependencies: the bundle manifest, the patch,
 * the locales, the icon, the runtime entry, the documented defaults, and the
 * absence of secret-looking strings must agree with each other.
 *
 * Run from the repository root: `node scripts/check.mjs`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) problems.push(message)
}

function readText(relative) {
  const path = join(root, relative)
  assert(existsSync(path), `missing file: ${relative}`)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function readJson(relative) {
  const text = readText(relative)
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    problems.push(`${relative} is not valid JSON: ${error.message}`)
    return undefined
  }
}

/** Expand the simple `dir/*.ext` and literal entries used by the manifest. */
function expand(entry) {
  if (!entry.includes('*')) return existsSync(join(root, entry)) ? [entry] : []
  const [directory, pattern] = entry.split('/*')
  const suffix = pattern.replace(/^\*/, '')
  const absolute = join(root, directory)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return []
  return readdirSync(absolute)
    .filter((file) => file.endsWith(suffix))
    .map((file) => `${directory}/${file}`)
}

// ------------------------------------------------------------- manifest ----
const manifest = readJson('package.json')
const EXPECTED_NAME = '@local/dsh-supermemory'

if (manifest !== undefined) {
  assert(manifest.name === EXPECTED_NAME, `package name must be ${EXPECTED_NAME}, found ${manifest.name}`)
  assert(typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version), 'version must be semver')
  assert(manifest.type === 'module', 'package must be an ES module')
  assert(manifest.license === 'MIT', 'license must be MIT')
  assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must point at cordis.patch.yml')
  assert(manifest.engines?.dsh !== undefined, 'declare engines.dsh so an incompatible Host refuses the install')
  assert(typeof manifest.scripts?.check === 'string', 'declare scripts.check so CI and humans run the same gate')

  for (const entry of manifest.files ?? []) {
    assert(expand(entry).length > 0, `files entry matches nothing: ${entry}`)
  }
  // Every exported subpath must resolve; a stale export breaks the Loader row.
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (target.includes('*')) {
      assert(expand(target.replace('./', '')).length > 0, `export ${key} matches nothing: ${target}`)
    } else {
      assert(existsSync(join(root, target)), `export ${key} points at a missing file: ${target}`)
    }
  }
}

// -------------------------------------------------------------- runtime ----
const entry = readText('index.js')
assert(/export const name = '[a-z-]+'/.test(entry), 'index.js must export a plugin name')
assert(/export const inject = \[[^\]]*'tools'/.test(entry), "index.js must inject 'tools'")
assert(/export const inject = \[[^\]]*'systemPrompt'/.test(entry), "index.js must inject 'systemPrompt'")
assert(/export const inject = \[[^\]]*'credentials'/.test(entry), "index.js must inject 'credentials'")
assert(/export function apply\(ctx, raw\)/.test(entry), 'index.js must export apply(ctx, raw)')
assert(/export const Config/.test(entry), 'index.js must export the Config schema for the Settings page')
assert(/export const internals/.test(entry), 'index.js must export internals so the unit tests can reach the pure helpers')
assert(existsSync(join(root, 'scripts/setup.mjs')), 'missing file: scripts/setup.mjs (self-hosted or cloud setup)')
assert(existsSync(join(root, 'SECURITY.md')), 'missing file: SECURITY.md')
// No namespace may be interpolated into a URL without encoding: a name is
// operator input, and an unencoded one could retarget the request.
assert(
  !/\/ns\/\$\{(?!encodeURIComponent)/.test(entry),
  'every /ns/ path must encode the namespace with encodeURIComponent',
)
assert(existsSync(join(root, 'test')), 'missing file: test/ (unit tests)')
assert(typeof manifest?.scripts?.test === 'string', 'declare scripts.test so CI runs the unit tests')
assert(manifest?.dependencies?.['@deepseek-ai/schemastery'] !== undefined, 'declare @deepseek-ai/schemastery so a git install resolves the Config schema')

// Every default the runtime declares must be documented in the README table,
// otherwise the table silently drifts away from the code.
const defaultsBlock = entry.match(/const DEFAULTS = \{([\s\S]*?)\n\}/)
assert(defaultsBlock !== null, 'index.js must declare a DEFAULTS block')
if (defaultsBlock !== null) {
  const keys = [...defaultsBlock[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
  assert(keys.length >= 20, `DEFAULTS looks truncated: found ${keys.length} keys`)
  const readme = readText('README.md')
  for (const key of keys) {
    assert(readme.includes(`\`${key}\``), `README does not document the default \`${key}\``)
  }
}

// ----------------------------------------------------------------- patch ----
const patch = readText('cordis.patch.yml')
for (const needle of [
  'id: supermemory',
  `name: '${EXPECTED_NAME}'`,
  'baseUrl:',
  'container: dsh',
  'readContainers:',
  'autoRecall:',
  'autoCapture:',
]) {
  assert(patch.includes(needle), `cordis.patch.yml must configure ${needle}`)
}
assert(!/allowWritesToReadContainers:\s*true/.test(patch), 'cordis.patch.yml must not enable writes to read-only containers')

// --------------------------------------------------------------- locales ----
const localeFiles = expand('locale/*.json')
assert(localeFiles.length > 0, 'locale/*.json matches nothing')
let referenceKeys
for (const file of localeFiles) {
  const data = readJson(file)
  if (data === undefined) continue
  const keys = Object.keys(data).sort()
  if (referenceKeys === undefined) referenceKeys = keys
  else assert(JSON.stringify(keys) === JSON.stringify(referenceKeys), `${file} has a different key set than ${localeFiles[0]}`)
}

// ------------------------------------------------------------------ icon ----
const icon = readText('icon.svg')
assert(icon.trimStart().startsWith('<svg'), 'icon.svg must be an SVG document')

// ------------------------------------------------------------------ docs ----
const readme = readText('README.md')
assert(readme.includes('scripts/setup.mjs'), 'README does not explain the setup script')
for (const tool of [
  'supermemory_search',
  'supermemory_profile',
  'supermemory_save',
  'supermemory_forget',
  'supermemory_read_document',
  'supermemory_list',
  'supermemory_namespaces',
  'supermemory_upload_file',
  'supermemory_namespace',
  'supermemory_buckets',
]) {
  assert(readme.includes(tool), `README does not mention the ${tool} tool`)
}
for (const doc of ['CHANGELOG.md', 'docs/DETAIL.md', 'AGENTS.md', 'SECURITY.md']) {
  assert(existsSync(join(root, doc)), `missing file: ${doc}`)
}

// --------------------------------------------------------------- secrets ----
const SECRET_PATTERNS = [/oc_sk_[A-Za-z0-9]/, /\bsk-[A-Za-z0-9]{16,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /"apiKey"\s*:\s*"[^"$]{8,}"/]
const scanned = ['index.js', 'cordis.patch.yml', 'package.json', 'README.md', 'CHANGELOG.md', 'AGENTS.md', 'docs/DETAIL.md', ...localeFiles]
for (const file of scanned) {
  const text = readText(file)
  for (const pattern of SECRET_PATTERNS) {
    assert(!pattern.test(text), `${file} looks like it contains a secret (${pattern})`)
  }
}

// ----------------------------------------------------------------- verdict ---
if (problems.length > 0) {
  console.error(`check: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`check: ok (${localeFiles.length} locale(s), ${(manifest?.files ?? []).length} manifest path(s))`)
