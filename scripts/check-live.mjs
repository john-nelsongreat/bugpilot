import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_LIVE_URL = 'https://bugpilot-lac.vercel.app'
export const ROUTES = Object.freeze([
  '/',
  '/bugs',
  '/bugs/new',
  '/assistant',
  '/__bugpilot-live-check-missing-9f3a2b__',
])
export const REQUIRED_HEADERS = Object.freeze([
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
])
export const REQUEST_TIMEOUT_MS = 10_000
export const MAX_RETRIES = 2
export const RETRY_DELAY_MS = 1_000
export const SLOW_REQUEST_MS = 8_000

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
      (candidate.source === '/(.*)' || candidate.source === '/:path*'),
  )

  if (!block || !Array.isArray(block.headers) || block.headers.length === 0) {
    return {
      ok: false,
      error:
        'No global headers "/(.*)" block was found in the Vercel configuration.',
    }
  }

  const headers = {}
  for (const header of block.headers) {
    if (
      header &&
      typeof header.key === 'string' &&
      typeof header.value === 'string'
    ) {
      headers[header.key.toLowerCase()] = header.value
    }
  }

  return { ok: true, headers }
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

function normalizeHeaderMap(headers) {
  const map = {}
  if (headers === null || typeof headers !== 'object') return map

  for (const [name, value] of Object.entries(headers)) {
    map[name.toLowerCase()] = String(value)
  }
  return map
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
  const base = normalizeBaseUrl(process.env.LIVE_URL)
  if (!base.ok) {
    console.error(`FAIL: ${base.error}`)
    process.exitCode = 1
    return
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(scriptDirectory, '..')
  // Testing-only override used to point the check at a modified Vercel config.
  const configPath = process.env.VERCEL_JSON_PATH
    ? resolve(process.env.VERCEL_JSON_PATH)
    : join(repositoryRoot, 'vercel.json')

  let vercelConfig
  try {
    vercelConfig = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    console.error(
      `FAIL: cannot read or parse ${configPath}: ${errorMessage(error)}`,
    )
    process.exitCode = 1
    return
  }

  const expected = extractGlobalHeaders(vercelConfig)
  if (!expected.ok) {
    console.error(`FAIL: ${expected.error}`)
    process.exitCode = 1
    return
  }

  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !(header.toLowerCase() in expected.headers),
  )
  if (missingHeaders.length > 0) {
    console.error(
      `FAIL: vercel.json is missing required headers: ${missingHeaders.join(
        ', ',
      )}`,
    )
    process.exitCode = 1
    return
  }

  const results = []
  const record = (label, pass, observed, details = []) => {
    results.push({ label, pass, observed, details })
  }

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

    const responseHeaders = Object.fromEntries(
      outcome.response.headers.entries(),
    )
    const headerResults = compareRequiredHeaders(
      expected.headers,
      responseHeaders,
    )
    const headersPass = headerResults.every((result) => result.pass)
    const matched = headerResults.filter((result) => result.pass).length
    record(
      `Headers ${route}`,
      headersPass,
      `${matched}/${REQUIRED_HEADERS.length} match vercel.json`,
      headerDetails(headerResults),
    )

    if (route === '/') rootHtml = outcome.body
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
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`FAIL: live check crashed: ${errorMessage(error)}`)
    process.exitCode = 1
  })
}
