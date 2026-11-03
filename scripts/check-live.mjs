import { execFileSync } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_LIVE_URL = 'https://bugpilot-lac.vercel.app'
export const ROUTES = Object.freeze([
  '/',
  '/bugs',
  '/bugs/new',
  '/assistant',
  '/analyze',
  '/__bugpilot-live-check-missing-9f3a2b__',
])
export const REQUIRED_HEADERS = Object.freeze([
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
])
/** Scripts and WebAssembly that define a worker need their own policy; see vercel.json. */
export const ENGINE_PATH_PREFIX = '/assets/engines/'
export const ENGINE_MANIFEST_PATH = '/assets/engines/manifest.json'
export const WASM_CONTENT_TYPE = 'application/wasm'
export const REQUEST_TIMEOUT_MS = 10_000
export const MAX_RETRIES = 2
export const RETRY_DELAY_MS = 1_000
export const SLOW_REQUEST_MS = 8_000
export const WORKFLOW_MESSAGE_LIMIT = 1800
export const GUARD_TITLE = 'Live check guard'
export const CRASH_TITLE = 'Live check crash'

const VERCEL_404_MARKERS = ['404: NOT_FOUND', 'Code: NOT_FOUND']
const JAVASCRIPT_CONTENT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
])
const CSS_CONTENT_TYPES = new Set(['text/css'])
const ROOT_ELEMENT_PATTERN = /\bid\s*=\s*["']root["']/i
const SCRIPT_WITH_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=/i
const TAG_PATTERN = /<(script|link|img|source)\b([^>]*)>/gi
const ATTRIBUTE_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export function normalizeBaseUrl(input) {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  const value = trimmed === '' ? DEFAULT_LIVE_URL : trimmed

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: `LIVE_URL is not a valid URL: ${value}` }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `LIVE_URL must start with http:// or https://: ${value}`,
    }
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, error: 'LIVE_URL must not contain credentials' }
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return {
      ok: false,
      error: `LIVE_URL must be an origin without a path, query or hash: ${value}`,
    }
  }

  return { ok: true, baseUrl: parsed.origin }
}

export function extractGlobalHeaders(vercelConfig) {
  const blocks = Array.isArray(vercelConfig?.headers)
    ? vercelConfig.headers
    : []
  const block = blocks.find(
    (candidate) =>
      candidate &&
      typeof candidate.source === 'string' &&
      isGlobalSource(candidate.source),
  )

  if (!block || !Array.isArray(block.headers) || block.headers.length === 0) {
    return {
      ok: false,
      error:
        'No global headers block was found in the Vercel configuration; expected source "/(.*)" or "/((?!assets/engines/).*)".',
    }
  }

  return { ok: true, headers: headerMapOf(block) }
}

/**
 * Every header rule in the configuration, in file order. Vercel applies each rule whose
 * source matches the path, and a browser intersects repeated `Content-Security-Policy`
 * headers, so a path covered by two rules would end up with the stricter of the two
 * policies. The live check therefore has to know which rule is supposed to win.
 */
export function extractHeaderRules(vercelConfig) {
  const blocks = Array.isArray(vercelConfig?.headers) ? vercelConfig.headers : []
  const rules = blocks
    .filter(
      (block) =>
        block &&
        typeof block.source === 'string' &&
        Array.isArray(block.headers),
    )
    .map((block) => ({ source: block.source, headers: headerMapOf(block) }))

  if (rules.length === 0) {
    return { ok: false, error: 'No header rules were found in the Vercel configuration.', rules: [] }
  }
  return { ok: true, rules }
}

const GLOBAL_SOURCES = new Set(['/(.*)', '/:path*'])
const GUARDED_GLOBAL_SOURCE = /^\/\(\(\?!([^)]*?)\)\.\*\)$/
// A literal prefix only: quantifiers, parameters and nested groups are path-to-regexp
// features this check does not implement, so a source using them is reported as unknown.
const SCOPED_PREFIX_SOURCE = /^\/([^()*+?{}:]*?)\(.*\)$/

/**
 * Whether one `source` pattern is the catch-all rule. `/((?!assets/engines/).*)` is the
 * same catch-all with the engine directory carved out, so it must be treated as global for
 * everything else.
 */
export function isGlobalSource(source) {
  if (GLOBAL_SOURCES.has(source)) return true
  const guarded = GUARDED_GLOBAL_SOURCE.exec(source)
  return guarded !== null && !guarded[1].startsWith('/')
}

/**
 * Does one rule cover one pathname? Returns `'yes'`, `'no'` or `'unknown'` — an unrecognised
 * pattern shape is reported instead of guessed at, because guessing here would let the check
 * pass or fail for the wrong reason. Only the three shapes BugPilot ships are understood.
 */
export function matchesSource(source, pathname) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const guarded = GUARDED_GLOBAL_SOURCE.exec(source)
  if (guarded) return path.startsWith(`/${guarded[1]}`) ? 'no' : 'yes'
  if (GLOBAL_SOURCES.has(source)) return 'yes'
  const scoped = SCOPED_PREFIX_SOURCE.exec(source)
  if (scoped) return path.startsWith(`/${scoped[1]}`) ? 'yes' : 'no'
  return 'unknown'
}

/** Which rule should describe this path, and how many rules actually claim it. */
export function expectedHeadersForPath(rules, pathname) {
  const matched = []
  const unknown = []
  for (const rule of rules) {
    const verdict = matchesSource(rule.source, pathname)
    if (verdict === 'yes') matched.push(rule)
    else if (verdict === 'unknown') unknown.push(rule.source)
  }

  if (matched.length > 1) {
    return {
      ok: false,
      error: `${pathname} matches ${matched.length} header rules (${matched
        .map((rule) => rule.source)
        .join(', ')}); Vercel would send several policies and the browser intersects them`,
      matched: matched.map((rule) => rule.source),
    }
  }
  if (matched.length === 0) {
    return {
      ok: false,
      error: unknown.length > 0
        ? `No rule could be evaluated for ${pathname}; unrecognised source shape(s): ${unknown.join(', ')}`
        : `No header rule covers ${pathname}`,
      matched: [],
    }
  }
  return { ok: true, rule: matched[0], headers: matched[0].headers, unknown }
}

/** The engine policy must differ from the main policy only in `script-src`. */
export function policiesDifferOnlyInScriptSrc(mainHeaders, engineHeaders) {
  const main = String(mainHeaders?.['content-security-policy'] ?? '')
  const engine = String(engineHeaders?.['content-security-policy'] ?? '')
  if (main === '' || engine === '') {
    return { pass: false, reason: 'one of the two policies is missing from vercel.json' }
  }
  const strip = (policy) => policy.replace(/script-src[^;]+(;|$)/g, '')
  if (strip(main) !== strip(engine)) {
    return { pass: false, reason: 'the two policies differ outside script-src' }
  }
  if (!engine.includes("'wasm-unsafe-eval'")) {
    return { pass: false, reason: 'the engine policy does not allow wasm-unsafe-eval' }
  }
  if (main.includes("'wasm-unsafe-eval'")) {
    return { pass: false, reason: 'the main policy allows wasm-unsafe-eval, so the scope is not narrowed' }
  }
  return { pass: true, reason: 'match' }
}

export function parseEngineManifest(text) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `manifest.json is not valid JSON: ${error?.message ?? error}` }
  }
  if (!manifest || !Array.isArray(manifest.files)) {
    return { ok: false, error: 'manifest.json has no "files" array' }
  }
  const files = manifest.files.filter(
    (entry) => entry && typeof entry.path === 'string' && typeof entry.kind === 'string',
  )
  if (files.length === 0) {
    return { ok: false, error: 'manifest.json lists no engine files' }
  }
  return { ok: true, schemaVersion: manifest.schemaVersion, files }
}

/**
 * Which engine files to probe live. Every script, one WebAssembly module per kind, and one
 * grammar per language: they all come from the same rule, so a sample proves the rule without
 * downloading every megabyte again.
 */
export function engineProbeTargets(files) {
  const targets = []
  const seenKinds = new Set()
  for (const entry of files) {
    const isScript = entry.path.endsWith('.js')
    const key = entry.kind === 'grammar' ? `grammar:${entry.language ?? '?'}` : entry.kind
    if (!isScript && seenKinds.has(key)) continue
    seenKinds.add(key)
    targets.push({
      path: entry.path,
      kind: entry.kind,
      language: entry.language ?? null,
      expect: isScript ? 'script' : entry.path.endsWith('.wasm') ? 'wasm' : 'other',
    })
  }
  return targets
}

/**
 * One engine response is only correct if the server sent exactly one policy — the engine one —
 * and the same four other headers as the rest of the site.
 */
export function classifyEngineResponse({
  target,
  status,
  contentType,
  cspValues,
  headerResults,
  elapsedMs,
  method,
}) {
  const failures = []

  if (status !== 200) failures.push(`HTTP ${status} (expected 200) via ${method}`)
  if (cspValues.length !== 1) {
    failures.push(
      `${cspValues.length} Content-Security-Policy header(s), expected exactly 1: ${JSON.stringify(
        cspValues,
      )}`,
    )
  }
  for (const result of headerResults) {
    if (!result.pass) {
      failures.push(
        `${result.header}: ${result.reason}; expected ${JSON.stringify(
          result.expected,
        )}, observed ${JSON.stringify(result.actual)}`,
      )
    }
  }

  const baseType = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (baseType === 'text/html') {
    failures.push('content type is text/html, so the engine file was not served as a file')
  } else if (target.expect === 'wasm' && baseType !== WASM_CONTENT_TYPE) {
    failures.push(`content type ${JSON.stringify(baseType)} is not ${WASM_CONTENT_TYPE}`)
  } else if (target.expect === 'script' && !JAVASCRIPT_CONTENT_TYPES.has(baseType)) {
    failures.push(`content type ${JSON.stringify(baseType)} is not a JavaScript type`)
  }

  const timing = classifyTiming(elapsedMs)
  if (!timing.pass) {
    failures.push(
      `request took ${elapsedMs} ms, above the ${SLOW_REQUEST_MS} ms limit`,
    )
  }

  return {
    pass: failures.length === 0,
    failures,
    observed: `${target.kind}${target.language ? `/${target.language}` : ''}; HTTP ${status}; ${
      baseType || '(no content type)'
    }; ${cspValues.length} CSP header(s); ${elapsedMs} ms via ${method}`,
  }
}

/** Values of one header from a raw `res.rawHeaders` list, duplicates preserved. */
export function headerValues(rawHeaders, name) {
  const wanted = name.toLowerCase()
  const values = []
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === wanted) {
      values.push(String(rawHeaders[index + 1]))
    }
  }
  return values
}

/** Pairs from a raw header list, later wins, so it can be compared with vercel.json. */
export function rawHeadersToObject(rawHeaders) {
  const object = {}
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    object[String(rawHeaders[index]).toLowerCase()] = String(rawHeaders[index + 1])
  }
  return object
}

export function compareRequiredHeaders(expected, actual) {
  const expectedMap = normalizeHeaderMap(expected)
  const actualMap = normalizeHeaderMap(actual)

  return REQUIRED_HEADERS.map((header) => {
    const key = header.toLowerCase()
    const expectedValue = expectedMap[key]
    const actualValue = actualMap[key] ?? null

    if (expectedValue === undefined) {
      return {
        header,
        pass: false,
        expected: null,
        actual: actualValue,
        reason: 'missing from vercel.json',
      }
    }

    if (actualValue === null) {
      return {
        header,
        pass: false,
        expected: expectedValue,
        actual: null,
        reason: 'missing from the response',
      }
    }

    if (actualValue !== expectedValue) {
      return {
        header,
        pass: false,
        expected: expectedValue,
        actual: actualValue,
        reason: 'different value',
      }
    }

    return {
      header,
      pass: true,
      expected: expectedValue,
      actual: actualValue,
      reason: 'match',
    }
  })
}

export function isHtmlContentType(value) {
  return typeof value === 'string' && /^text\/html(?:\s*;|$)/i.test(value.trim())
}

export function classifyTiming(elapsedMs) {
  const slow = Number(elapsedMs) > SLOW_REQUEST_MS
  return { pass: !slow, slow, elapsedMs }
}

export function classifyRouteResponse({
  status,
  contentType,
  body,
  elapsedMs,
  location,
}) {
  const failures = []
  const text = typeof body === 'string' ? body : ''
  const redirectedTo = location ?? null

  if (status >= 300 && status < 400) {
    failures.push(
      `HTTP ${status} is a redirect${
        redirectedTo === null ? '' : ` to ${redirectedTo}`
      }; redirects are not followed`,
    )
  } else if (status !== 200) {
    failures.push(`HTTP ${status} (expected 200)`)
  }

  if (!isHtmlContentType(contentType)) {
    failures.push(
      `content type ${JSON.stringify(contentType ?? null)} is not text/html`,
    )
  }

  const marker = VERCEL_404_MARKERS.find((candidate) =>
    text.toLowerCase().includes(candidate.toLowerCase()),
  )
  if (marker !== undefined) {
    failures.push(`body contains the Vercel 404 marker ${JSON.stringify(marker)}`)
  }

  if (!ROOT_ELEMENT_PATTERN.test(text)) {
    failures.push('body does not contain the app root element (#root)')
  }

  if (!SCRIPT_WITH_SRC_PATTERN.test(text)) {
    failures.push('body does not contain a script element with a src attribute')
  }

  const timing = classifyTiming(elapsedMs)
  if (!timing.pass) {
    failures.push(
      `request took ${elapsedMs} ms, above the ${SLOW_REQUEST_MS} ms limit`,
    )
  }

  return {
    pass: failures.length === 0,
    failures,
    observed: {
      status,
      contentType: contentType ?? null,
      elapsedMs,
      redirectedTo,
      bodyBytes: Buffer.byteLength(text),
    },
  }
}

export function classifyAssetResponse({
  kind,
  status,
  contentType,
  elapsedMs,
  location,
}) {
  const failures = []
  const redirectedTo = location ?? null

  if (status >= 300 && status < 400) {
    failures.push(
      `HTTP ${status} is a redirect${
        redirectedTo === null ? '' : ` to ${redirectedTo}`
      }; redirects are not followed`,
    )
  } else if (status !== 200) {
    failures.push(`HTTP ${status} (expected 200)`)
  }

  const baseType = String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  const sensible =
    kind === 'script'
      ? JAVASCRIPT_CONTENT_TYPES.has(baseType)
      : kind === 'stylesheet' && CSS_CONTENT_TYPES.has(baseType)

  if (!sensible) {
    failures.push(
      `content type ${JSON.stringify(
        contentType ?? null,
      )} is not a sensible ${kind} type`,
    )
  }

  const timing = classifyTiming(elapsedMs)
  if (!timing.pass) {
    failures.push(
      `request took ${elapsedMs} ms, above the ${SLOW_REQUEST_MS} ms limit`,
    )
  }

  return {
    pass: failures.length === 0,
    failures,
    observed: {
      kind,
      status,
      contentType: contentType ?? null,
      elapsedMs,
      redirectedTo,
    },
  }
}

export function extractAssetUrls(html, pageUrl) {
  const assets = []
  const external = []
  const seen = new Set()
  const base = new URL(pageUrl)
  const source = typeof html === 'string' ? html.replace(/<!--[\s\S]*?-->/g, '') : ''

  const add = (kind, rawValue) => {
    const raw = String(rawValue ?? '').trim()
    if (raw === '') return

    let absolute
    try {
      absolute = new URL(raw, base)
    } catch {
      const invalid = { kind, raw, url: raw, sameOrigin: false }
      assets.push(invalid)
      external.push(invalid)
      return
    }

    const key = `${kind} ${absolute.href}`
    if (seen.has(key)) return
    seen.add(key)

    const asset = {
      kind,
      raw,
      url: absolute.href,
      sameOrigin: absolute.origin === base.origin,
    }
    assets.push(asset)
    if (!asset.sameOrigin) external.push(asset)
  }

  const addSrcset = (value) => {
    for (const candidate of String(value ?? '').split(',')) {
      const url = candidate.trim().split(/\s+/)[0]
      if (url !== undefined && url !== '' && !url.startsWith('data:')) {
        add('image', url)
      }
    }
  }

  let match
  TAG_PATTERN.lastIndex = 0
  while ((match = TAG_PATTERN.exec(source)) !== null) {
    const tag = match[1].toLowerCase()
    const attributes = parseAttributes(match[2])

    if (tag === 'script') {
      add('script', attributes.src)
      continue
    }

    if (tag === 'img') {
      add('image', attributes.src)
      addSrcset(attributes.srcset)
      continue
    }

    if (tag === 'source') {
      const type = String(attributes.type ?? '').toLowerCase()
      if (attributes.srcset !== undefined || type.startsWith('image/')) {
        add('image', attributes.src)
        addSrcset(attributes.srcset)
      }
      continue
    }

    const rel = String(attributes.rel ?? '').toLowerCase().split(/\s+/)
    if (rel.includes('stylesheet')) {
      add('stylesheet', attributes.href)
    } else if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      add('image', attributes.href)
    } else if (
      (rel.includes('preload') || rel.includes('prefetch')) &&
      String(attributes.as ?? '').toLowerCase() === 'font'
    ) {
      add('font', attributes.href)
    } else if (rel.includes('modulepreload')) {
      add('script', attributes.href)
    }
  }

  return { assets, external }
}

export function shouldRetry({ attempt, error }) {
  return Boolean(error) && attempt < MAX_RETRIES
}

export function isTimeoutError(error) {
  return (
    Boolean(error) &&
    (error.name === 'TimeoutError' ||
      error.cause?.name === 'TimeoutError')
  )
}

// Workflow command data: "%", CR and LF carry meaning and must be percent-encoded.
export function escapeWorkflowData(value) {
  return String(value ?? '')
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

// Workflow command properties additionally use ":" and "=" as separators.
export function escapeWorkflowProperty(value) {
  return String(value ?? '')
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll('=', '%3D')
}

export function truncateWorkflowMessage(value, limit = WORKFLOW_MESSAGE_LIMIT) {
  const text = String(value ?? '')
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 12))}…[truncated]`
}

export function formatWorkflowError({
  title,
  message,
  limit = WORKFLOW_MESSAGE_LIMIT,
}) {
  return `::error title=${escapeWorkflowProperty(title)}::${escapeWorkflowData(
    truncateWorkflowMessage(message, limit),
  )}`
}

export function formatRunHeader({ nodeVersion, baseUrl, urlSource, commit, utcTime }) {
  return `run node=${nodeVersion} url=${baseUrl} urlSource=${urlSource} commit=${
    commit ?? 'unknown'
  } time=${utcTime}`
}

export function describeUrlSource(rawLiveUrl) {
  return typeof rawLiveUrl === 'string' && rawLiveUrl.trim() !== ''
    ? 'LIVE_URL'
    : 'default'
}

export function guardResult(name, message) {
  return { label: `Guard ${name}`, pass: false, observed: message, details: [] }
}

export function formatSummaryCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll(/\r\n/g, '<br>')
    .replaceAll(/[\r\n]/g, '<br>')
}

export function buildStepSummary({ baseUrl, commit, results }) {
  const failed = results.filter((result) => !result.pass)
  const lines = [
    `## BugPilot live site check — ${failed.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    `- Base URL: \`${baseUrl ?? ''}\``,
    `- Commit: \`${commit ?? 'unknown'}\``,
    `- Checks: ${results.length - failed.length} passed, ${failed.length} failed`,
    '',
    '| Check | Result | Observed | Failing details |',
    '| --- | --- | --- | --- |',
  ]

  for (const result of results) {
    const details =
      result.details.length > 0
        ? result.details.join('; ')
        : result.pass
          ? ''
          : result.observed
    lines.push(
      `| ${formatSummaryCell(result.label)} | ${result.pass ? 'PASS' : 'FAIL'} | ${formatSummaryCell(
        result.observed,
      )} | ${formatSummaryCell(details)} |`,
    )
  }

  lines.push('')
  return lines.join('\n')
}

export function resolveStepSummaryPath(env) {
  const value =
    typeof env?.GITHUB_STEP_SUMMARY === 'string' ? env.GITHUB_STEP_SUMMARY.trim() : ''
  return value === '' ? null : resolve(value)
}

export function crashMessage(error) {
  const name = error?.name ?? 'Error'
  const message =
    error?.message ?? String(error ?? 'unknown live check failure')
  const stack = typeof error?.stack === 'string' ? `\n${error.stack}` : ''
  return `${name}: ${message}${stack}`
}

export function readRepositoryCommit(cwd) {
  try {
    const output = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    })
    const sha = String(output).trim()
    return /^[0-9a-f]{4,40}$/i.test(sha) ? sha : null
  } catch {
    return null
  }
}

export function failureAnnotation(result) {
  const message = [result.observed, ...result.details].filter(Boolean).join(' | ')
  return formatWorkflowError({ title: result.label, message })
}

function normalizeHeaderMap(headers) {
  const map = {}
  if (headers === null || typeof headers !== 'object') return map

  for (const [name, value] of Object.entries(headers)) {
    map[name.toLowerCase()] = String(value)
  }
  return map
}

function headerMapOf(block) {
  const headers = {}
  for (const header of block?.headers ?? []) {
    if (
      header &&
      typeof header.key === 'string' &&
      typeof header.value === 'string'
    ) {
      headers[header.key.toLowerCase()] = header.value
    }
  }
  return headers
}

function parseAttributes(source) {
  const attributes = {}
  let match
  ATTRIBUTE_PATTERN.lastIndex = 0
  while ((match = ATTRIBUTE_PATTERN.exec(source)) !== null) {
    const name = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (!(name in attributes)) attributes[name] = value
  }
  return attributes
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

function errorMessage(error) {
  const message =
    error?.cause?.message ?? error?.message ?? String(error ?? 'unknown error')
  return isTimeoutError(error)
    ? `timed out after ${REQUEST_TIMEOUT_MS} ms (${message})`
    : message
}

async function request(url) {
  const startedAt = performance.now()

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const body = await response.text()
      return {
        response,
        body,
        error: null,
        attempts: attempt + 1,
        elapsedMs: Math.round(performance.now() - startedAt),
      }
    } catch (error) {
      if (!shouldRetry({ attempt, error })) {
        return {
          response: null,
          body: '',
          error,
          attempts: attempt + 1,
          elapsedMs: Math.round(performance.now() - startedAt),
        }
      }
      await sleep(RETRY_DELAY_MS)
    }
  }
}

/**
 * `fetch` merges repeated response headers into one comma-joined value, which is exactly the
 * detail this check has to count: two `Content-Security-Policy` headers are intersected by the
 * browser and would silently re-block WebAssembly. Engine files are therefore probed with a raw
 * request that keeps the duplicates separate. Redirects are not followed.
 */
export function rawRequest(url, method = 'HEAD', timeoutMs = REQUEST_TIMEOUT_MS) {
  const startedAt = performance.now()
  const target = new URL(url)
  const send = target.protocol === 'http:' ? httpRequest : httpsRequest

  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolvePromise({
        ...result,
        method,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
    }

    const req = send(target, { method, headers: { accept: '*/*' } }, (res) => {
      const rawHeaders = res.rawHeaders ?? []
      const status = res.statusCode ?? 0
      // The headers are the whole point; a WebAssembly module is megabytes, so drop the body.
      res.destroy()
      finish({ ok: true, status, rawHeaders, error: null })
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timed out after ${timeoutMs} ms`))
    })
    req.on('error', (error) => finish({ ok: false, status: 0, rawHeaders: [], error }))
    req.end()
  })
}

/** Same retry policy as the fetch requests: a cold TLS handshake is not a failing site. */
async function requestRawWithRetry(url, method) {
  let last = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    last = await rawRequest(url, method)
    if (last.ok) return last
    if (attempt + 1 < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
  }
  return last ?? (await rawRequest(url, method))
}

/** HEAD is enough for headers; fall back to GET when a server refuses it. */
async function probeHeaders(url) {
  const head = await requestRawWithRetry(url, 'HEAD')
  if (head.ok && head.status !== 405 && head.status !== 501) return head
  const get = await requestRawWithRetry(url, 'GET')
  return get.ok ? get : head
}

function headerDetails(headerResults) {
  return headerResults
    .filter((result) => !result.pass)
    .map(
      (result) =>
        `${result.header}: ${result.reason}; expected ${JSON.stringify(
          result.expected,
        )}, observed ${JSON.stringify(result.actual)}`,
    )
}

function assetLabel(asset) {
  const kind = asset.kind === 'script' ? 'Script' : 'Stylesheet'
  let path = asset.url
  try {
    const parsed = new URL(asset.url)
    path = `${parsed.pathname}${parsed.search}`
  } catch {
    // Keep the raw value when the URL cannot be parsed.
  }
  return `${kind} ${path}`
}

async function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(scriptDirectory, '..')
  // Testing-only override used to point the check at a modified Vercel config.
  const configPath = process.env.VERCEL_JSON_PATH
    ? resolve(process.env.VERCEL_JSON_PATH)
    : join(repositoryRoot, 'vercel.json')

  const inGithub = process.env.GITHUB_ACTIONS === 'true'
  const stepSummaryPath = resolveStepSummaryPath(process.env)

  const rawLiveUrl =
    typeof process.env.LIVE_URL === 'string' ? process.env.LIVE_URL.trim() : ''
  const base = normalizeBaseUrl(process.env.LIVE_URL)
  let runUrl = rawLiveUrl
  if (base.ok) runUrl = base.baseUrl
  else if (rawLiveUrl === '') runUrl = DEFAULT_LIVE_URL

  const commit = readRepositoryCommit(repositoryRoot)
  console.log(
    formatRunHeader({
      nodeVersion: `v${process.versions.node}`,
      baseUrl: runUrl,
      urlSource: describeUrlSource(rawLiveUrl),
      commit,
      utcTime: new Date().toISOString(),
    }),
  )

  const writeSummary = async (results) => {
    if (stepSummaryPath === null) return
    try {
      await appendFile(
        stepSummaryPath,
        buildStepSummary({ baseUrl: runUrl, commit, results }),
        'utf8',
      )
    } catch (error) {
      console.error(`FAIL: cannot write the step summary: ${errorMessage(error)}`)
    }
  }

  const reportGuard = async (name, message) => {
    console.error(`FAIL: ${message}`)
    if (inGithub) {
      console.log(
        formatWorkflowError({
          title: GUARD_TITLE,
          message: `${name}: ${message}`,
        }),
      )
    }
    await writeSummary([guardResult(name, message)])
  }

  if (!base.ok) {
    await reportGuard('LIVE_URL', base.error)
    process.exitCode = 1
    return
  }

  let vercelConfig
  try {
    vercelConfig = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    await reportGuard(
      'vercel.json',
      `cannot read or parse ${configPath}: ${errorMessage(error)}`,
    )
    process.exitCode = 1
    return
  }

  const rulesResult = extractHeaderRules(vercelConfig)
  if (!rulesResult.ok) {
    await reportGuard('vercel.json', rulesResult.error)
    process.exitCode = 1
    return
  }
  const rules = rulesResult.rules
  const globalRule = rules.find((rule) => isGlobalSource(rule.source))
  const engineRule = rules.find((rule) =>
    rule.source.includes(ENGINE_PATH_PREFIX.trimStart('/')),
  )

  if (!globalRule) {
    await reportGuard(
      'vercel.json',
      'No global headers block was found in the Vercel configuration; expected source "/(.*)" or "/((?!assets/engines/).*)".',
    )
    process.exitCode = 1
    return
  }

  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !(header.toLowerCase() in globalRule.headers),
  )
  if (missingHeaders.length > 0) {
    await reportGuard(
      'vercel.json',
      `vercel.json is missing required headers: ${missingHeaders.join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  const results = []
  const record = (label, pass, observed, details = []) => {
    results.push({ label, pass, observed, details })
  }

  // The two policies are a deliberate split: the engine directory is the only place a
  // WebAssembly module may compile. If vercel.json ever loosens anything else, or tightens the
  // engine policy into something the worker cannot use, the live site would break quietly.
  const scope = policiesDifferOnlyInScriptSrc(globalRule?.headers, engineRule?.headers)
  record(
    'vercel.json policy split',
    scope.pass && engineRule !== undefined,
    engineRule
      ? `${engineRule.source}: ${scope.reason}`
      : `no rule for ${ENGINE_PATH_PREFIX} in vercel.json`,
  )

  console.log('BugPilot live site check')
  console.log(`Base URL: ${base.baseUrl}`)
  console.log(`Expected headers from: ${configPath}`)
  console.log(`Routes: ${ROUTES.join(', ')}`)
  console.log('')

  let rootHtml = ''

  for (const route of ROUTES) {
    const url = new URL(route, base.baseUrl).href
    const outcome = await request(url)
    const label = `GET ${route}`

    if (outcome.error !== null) {
      const timeoutNote = isTimeoutError(outcome.error) ? ' (timeout)' : ''
      record(
        label,
        false,
        `network error${timeoutNote} after ${outcome.attempts} attempt(s): ${errorMessage(
          outcome.error,
        )}; ${outcome.elapsedMs} ms`,
      )
      record(`Headers ${route}`, false, 'no response to inspect')
      continue
    }

    const routeResult = classifyRouteResponse({
      status: outcome.response.status,
      contentType: outcome.response.headers.get('content-type'),
      body: outcome.body,
      elapsedMs: outcome.elapsedMs,
      location: outcome.response.headers.get('location'),
    })
    record(
      label,
      routeResult.pass,
      `HTTP ${outcome.response.status}; ${outcome.response.headers.get(
        'content-type',
      ) ?? '(no content type)'}; ${outcome.elapsedMs} ms${
        outcome.attempts > 1 ? `; ${outcome.attempts} attempts` : ''
      }`,
      routeResult.failures,
    )

    const forPath = expectedHeadersForPath(rules, route)
    if (!forPath.ok) {
      record(`Headers ${route}`, false, forPath.error)
      continue
    }

    const responseHeaders = Object.fromEntries(
      outcome.response.headers.entries(),
    )
    const headerResults = compareRequiredHeaders(
      forPath.headers,
      responseHeaders,
    )
    const headersPass = headerResults.every((result) => result.pass)
    const matched = headerResults.filter((result) => result.pass).length
    record(
      `Headers ${route}`,
      headersPass,
      `${matched}/${REQUIRED_HEADERS.length} match ${forPath.rule.source}`,
      headerDetails(headerResults),
    )

    if (route === '/') rootHtml = outcome.body
  }

  // One policy header, not two: a browser intersects duplicates, and a second (stricter)
  // policy on the main document would block the engine worker before it starts.
  const rootProbe = await probeHeaders(new URL('/', base.baseUrl).href)
  if (!rootProbe.ok) {
    record(
      'Main document CSP count',
      false,
      `raw request failed: ${errorMessage(rootProbe.error)}`,
    )
  } else {
    const policies = headerValues(rootProbe.rawHeaders, 'content-security-policy')
    record(
      'Main document CSP count',
      policies.length === 1 && !policies.some((value) => value.includes("'wasm-unsafe-eval'")),
      `${policies.length} CSP header(s), wasm-unsafe-eval ${
        policies.some((value) => value.includes("'wasm-unsafe-eval'")) ? 'present' : 'absent'
      }`,
      policies,
    )
  }

  if (rootHtml === '') {
    record('Same-origin assets', false, 'not checked: no HTML response from /')
  } else {
    const pageUrl = `${base.baseUrl}/`
    const { assets, external } = extractAssetUrls(rootHtml, pageUrl)

    record(
      'Same-origin assets',
      external.length === 0,
      external.length === 0
        ? `${assets.length}/${assets.length} URLs are same-origin`
        : `${external.length} external URL(s): ${external
            .map((asset) => asset.url)
            .join(', ')}`,
    )

    const fetchable = assets.filter(
      (asset) =>
        asset.sameOrigin &&
        (asset.kind === 'script' || asset.kind === 'stylesheet'),
    )

    if (fetchable.length === 0) {
      record(
        'Assets',
        false,
        'no same-origin script or stylesheet URL found in /',
      )
    }

    for (const asset of fetchable) {
      const outcome = await request(asset.url)
      const label = assetLabel(asset)

      if (outcome.error !== null) {
        const timeoutNote = isTimeoutError(outcome.error) ? ' (timeout)' : ''
        record(
          label,
          false,
          `network error${timeoutNote} after ${outcome.attempts} attempt(s): ${errorMessage(
            outcome.error,
          )}; ${outcome.elapsedMs} ms`,
        )
        continue
      }

      const assetResult = classifyAssetResponse({
        kind: asset.kind,
        status: outcome.response.status,
        contentType: outcome.response.headers.get('content-type'),
        elapsedMs: outcome.elapsedMs,
        location: outcome.response.headers.get('location'),
      })
      record(
        label,
        assetResult.pass,
        `HTTP ${outcome.response.status}; ${outcome.response.headers.get(
          'content-type',
        ) ?? '(no content type)'}; ${outcome.elapsedMs} ms${
          outcome.attempts > 1 ? `; ${outcome.attempts} attempts` : ''
        }`,
        assetResult.failures,
      )
    }
  }

  // ---- engine files -------------------------------------------------------------
  // The deployed build writes assets/engines/manifest.json at build time, so the live check
  // probes the files the browser will really fetch instead of made-up paths. Every one of them
  // must carry the engine policy exactly once.
  const manifestOutcome = await request(new URL(ENGINE_MANIFEST_PATH, base.baseUrl).href)
  if (manifestOutcome.error !== null) {
    record(
      'Engine manifest',
      false,
      `network error: ${errorMessage(manifestOutcome.error)}; ${manifestOutcome.elapsedMs} ms`,
    )
    record('Engine headers', false, 'not checked: no engine manifest')
  } else if (manifestOutcome.response.status !== 200) {
    record(
      'Engine manifest',
      false,
      `HTTP ${manifestOutcome.response.status} for ${ENGINE_MANIFEST_PATH}`,
    )
    record('Engine headers', false, 'not checked: no engine manifest')
  } else {
    const parsed = parseEngineManifest(manifestOutcome.body)
    if (!parsed.ok) {
      record('Engine manifest', false, parsed.error)
      record('Engine headers', false, 'not checked: unreadable engine manifest')
    } else {
      const manifestHeaders = Object.fromEntries(
        manifestOutcome.response.headers.entries(),
      )
      const manifestForPath = expectedHeadersForPath(rules, ENGINE_MANIFEST_PATH)
      const manifestHeaderResults = manifestForPath.ok
        ? compareRequiredHeaders(manifestForPath.headers, manifestHeaders)
        : []
      record(
        'Engine manifest',
        parsed.files.length > 0 &&
          manifestHeaderResults.every((result) => result.pass),
        `schema ${parsed.schemaVersion}; ${parsed.files.length} file(s); ${
          manifestForPath.ok
            ? `${manifestHeaderResults.filter((result) => result.pass).length}/${
                REQUIRED_HEADERS.length
              } headers match ${manifestForPath.rule.source}`
            : manifestForPath.error
        }`,
        [
          ...(parsed.files.length === 0 ? ['manifest lists no files'] : []),
          ...headerDetails(manifestHeaderResults),
        ],
      )

      if (!engineRule) {
        record('Engine headers', false, 'no engine rule in vercel.json to compare with')
      } else {
        for (const target of engineProbeTargets(parsed.files)) {
          const url = new URL(target.path, base.baseUrl).href
          const probe = await probeHeaders(url)
          if (!probe.ok) {
            record(
              `Engine ${target.path}`,
              false,
              `raw request failed: ${errorMessage(probe.error)}`,
            )
            continue
          }
          const policies = headerValues(probe.rawHeaders, 'content-security-policy')
          const classified = classifyEngineResponse({
            target,
            status: probe.status,
            contentType: headerValues(probe.rawHeaders, 'content-type')[0] ?? null,
            cspValues: policies,
            headerResults: compareRequiredHeaders(
              engineRule.headers,
              rawHeadersToObject(probe.rawHeaders),
            ),
            elapsedMs: probe.elapsedMs,
            method: probe.method,
          })
          record(
            `Engine ${target.path}`,
            classified.pass,
            classified.observed,
            classified.failures,
          )
        }
      }
    }
  }

  const failed = results.filter((result) => !result.pass)
  const passed = results.length - failed.length

  console.log('SUMMARY')
  for (const result of results) {
    console.log(
      `${result.pass ? 'PASS' : 'FAIL'}  ${result.label.padEnd(38)} ${result.observed}`,
    )
  }

  if (failed.length > 0) {
    console.log('')
    console.log('FAILURE DETAILS')
    for (const result of failed) {
      console.log(`- ${result.label}`)
      for (const detail of result.details.length > 0
        ? result.details
        : [result.observed]) {
        console.log(`    ${detail}`)
      }
    }
  }

  console.log('')
  console.log(`${passed} passed, ${failed.length} failed`)
  if (failed.length === 0) {
    console.log('PASS — the live site is healthy.')
    process.exitCode = 0
  } else {
    console.log('FAIL — the live site is not healthy.')
    process.exitCode = 1
  }

  for (const result of failed) {
    if (inGithub) console.log(failureAnnotation(result))
  }
  await writeSummary(results)
}

async function reportCrash(error) {
  console.error(`FAIL: live check crashed: ${errorMessage(error)}`)
  const detail = crashMessage(error)
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(formatWorkflowError({ title: CRASH_TITLE, message: detail }))
  }

  const stepSummaryPath = resolveStepSummaryPath(process.env)
  if (stepSummaryPath !== null) {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const rawLiveUrl =
      typeof process.env.LIVE_URL === 'string' ? process.env.LIVE_URL.trim() : ''
    try {
      await appendFile(
        stepSummaryPath,
        buildStepSummary({
          baseUrl: rawLiveUrl === '' ? DEFAULT_LIVE_URL : rawLiveUrl,
          commit: readRepositoryCommit(repositoryRoot),
          results: [guardResult('unexpected exception', detail)],
        }),
        'utf8',
      )
    } catch (summaryError) {
      console.error(
        `FAIL: cannot write the step summary: ${errorMessage(summaryError)}`,
      )
    }
  }

  process.exitCode = 1
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  const run = async () => {
    try {
      await main()
    } catch (error) {
      await reportCrash(error)
    }
  }
  void run()
}
