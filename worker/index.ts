import { runSync } from './sync'
import type { Env } from './types'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const CACHE_CONTROL = 'public, max-age=60, s-maxage=300'

function json(data: unknown, status = 200, cacheable = true): Response {
  const cache = cacheable && status < 400 ? CACHE_CONTROL : 'no-store'
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  })
}

async function readData(env: Env, key: string): Promise<unknown> {
  const raw = await env.STATUS_KV.get(key)
  if (!raw) return { updatedAt: '', regions: {} }
  try {
    return JSON.parse(raw)
  } catch {
    return { updatedAt: '', regions: {} }
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (path === '/api/status' && request.method === 'GET') {
    const [status, notices, agents] = await Promise.all([
      readData(env, 'status'),
      readData(env, 'notices'),
      readData(env, 'agents'),
    ])
    return json({ status, notices, agents })
  }

  if (path === '/api/refresh' && request.method === 'POST') {
    const token = env.API_TOKEN
    if (token) {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${token}`) return json({ error: 'unauthorized' }, 401)
    }
    try {
      const ok = await runSync(env)
      return json({ ok }, 200, false)
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200, false)
    }
  }

  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'ss-status' })
  }

  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env)
    } catch (err) {
      console.error('fetch error -', err instanceof Error ? err.message : String(err))
      return json({ error: 'internal error' }, 500)
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSync(env))
  },
}
