import fallback from './config.fallback.json'
import type { Env, RegionConfig } from './types'

const CONFIG_URL = 'https://raw.githubusercontent.com/MakoStar/ss-scripts/main/config.json'
const KV_CONFIG = 'config'
const CONFIG_TTL = 6 * 60 * 60 * 1000

interface RawRegion {
  TAG: string
  SALT: string
  API_URL: string
  PKG_URL: string
  PKG_ROUTE: string
  STATIC_URL: string
  SERVER_META_KEY: string
}

interface RawConfig {
  REGIONS: string[]
  [key: string]: unknown
}

interface ConfigCache {
  raw: RawConfig
  at: number
}

const REQUIRED_FIELDS: (keyof RawRegion)[] = [
  'TAG', 'SALT', 'API_URL', 'PKG_URL', 'PKG_ROUTE', 'STATIC_URL', 'SERVER_META_KEY',
]

/** 校验配置结构异常时回退 */
function validRaw(value: unknown): value is RawConfig {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.REGIONS) || !raw.REGIONS.length) return false
  return raw.REGIONS.every(name => {
    if (typeof name !== 'string') return false
    const region = raw[name]
    if (!region || typeof region !== 'object') return false
    return REQUIRED_FIELDS.every(field => typeof (region as Record<string, unknown>)[field] === 'string')
  })
}

/** 拉取远程原始配置 */
async function fetchRawConfig(): Promise<RawConfig> {
  const res = await fetch(CONFIG_URL, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`config HTTP ${res.status}`)
  const data: unknown = await res.json()
  if (!validRaw(data)) throw new Error('config schema invalid')
  return data
}

/** 读取缓存配置 */
async function readCache(env: Env): Promise<ConfigCache | null> {
  const value = await env.STATUS_KV.get(KV_CONFIG)
  if (!value) return null
  try {
    const cache = JSON.parse(value) as ConfigCache
    return cache && validRaw(cache.raw) ? cache : null
  } catch {
    return null
  }
}

/** 加载配置缓存优先过期回源失败回退旧缓存 */
export async function loadConfig(env: Env): Promise<{ regions: Record<string, RegionConfig>, names: string[] }> {
  const cache = await readCache(env)
  let raw: RawConfig
  if (cache && Date.now() - cache.at < CONFIG_TTL) {
    raw = cache.raw
  } else {
    try {
      raw = await fetchRawConfig()
      await env.STATUS_KV.put(KV_CONFIG, JSON.stringify({ raw, at: Date.now() }))
    } catch {
      raw = cache?.raw ?? fallback as RawConfig
    }
  }
  const regions: Record<string, RegionConfig> = {}
  for (const name of raw.REGIONS) {
    const r = raw[name] as RawRegion
    regions[name] = {
      static: r.STATIC_URL,
      launcher: r.API_URL,
      pkg: r.PKG_URL + r.PKG_ROUTE,
      tag: r.TAG,
      key: r.SERVER_META_KEY,
      salt: r.SALT,
    }
  }
  return { regions, names: raw.REGIONS }
}
