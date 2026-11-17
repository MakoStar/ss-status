import crypto from 'node:crypto'
import { loadConfig } from './config'
import { decrypt, parseServerList, parseNoticeList } from './decoder'
import { fetchManifestVersions } from './manifest'
import { publishJson } from './github'
import type { Env, RegionConfig, RegionData, RegionMap, DataSet, NoticeGroup } from './types'

const KV_STATUS = 'status'
const KV_NOTICES = 'notices'
const KV_AGENTS = 'agents'
const KV_LAST_SYNC = 'last-sync'
const MIN_SYNC_INTERVAL = 60 * 1000

/** 请求远程二进制 */
async function fetchBinary(url: string, headers: Record<string, string>, timeout: number, retries = 2): Promise<Uint8Array> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw lastErr
}

/** 请求远程文本 */
async function fetchText(url: string, headers: Record<string, string>, timeout: number): Promise<string> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 计算启动器请求签名 */
function launcherAuth(cfg: RegionConfig, version: string): string {
  const head = { game_tag: cfg.tag, time: Math.floor(Date.now() / 1000), version }
  const sign = crypto.createHash('md5').update(JSON.stringify(head) + cfg.salt).digest('hex')
  return JSON.stringify({ head, sign })
}

/** 获取启动器版本 */
async function fetchLauncherVersion(cfg: RegionConfig): Promise<string> {
  const text = await fetchText(`${cfg.pkg}/${cfg.tag}/latest.yml`, { 'Cache-Control': 'no-cache' }, 15000)
  const version = text.match(/^version:[ \t]*(.+)$/m)?.[1].trim()
  if (!version) throw new Error('latest.yml missing version')
  return version.replace(/^["']|["']$/g, '')
}

/** 获取客户端版本 */
async function fetchClientVersion(cfg: RegionConfig, launcherVersion: string): Promise<string> {
  const auth = launcherAuth(cfg, launcherVersion)
  const res = await fetch(`${cfg.launcher}/api/launcher/game/config`, {
    headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`launcher HTTP ${res.status}`)
  const version = (await res.json() as { data?: { game_latest_version?: string } })?.data?.game_latest_version
  if (!version) throw new Error('game_latest_version missing')
  return version
}

/** 读取上一轮缓存 */
async function readPrevious(env: Env): Promise<RegionMap<RegionData>> {
  const [status, notices, agents] = await Promise.all([
    env.STATUS_KV.get(KV_STATUS),
    env.STATUS_KV.get(KV_NOTICES),
    env.STATUS_KV.get(KV_AGENTS),
  ])
  const out: RegionMap<RegionData> = {}
  try {
    const s = status ? JSON.parse(status) : {}
    const n = notices ? JSON.parse(notices) : {}
    const a = agents ? JSON.parse(agents) : {}
    for (const region of Object.keys(s.regions ?? {})) {
      out[region] = {
        ...s.regions[region],
        notices: n.regions?.[region] ?? [],
        agents: a.regions?.[region] ?? [],
      }
    }
  } catch {}
  return out
}

/** 规范化公告分组 */
function normalizeNotices(groups: { name: string, detail: { id: string, title: string, contentUrl: string, endAt: number, sort: number }[] }[]): NoticeGroup[] {
  return (groups ?? [])
    .filter(g => Array.isArray(g.detail) && g.detail.length > 0)
    .map(g => ({
      name: g.name,
      detail: g.detail
        .map(item => ({ id: item.id, title: item.title, contentUrl: item.contentUrl, endAt: item.endAt, sort: item.sort }))
        .filter(item => item.title)
        .sort((a, b) => b.sort - a.sort),
    }))
}

/** 抓取单个区服 */
async function fetchRegion(
  cfg: RegionConfig,
  previous: RegionData | undefined,
  manifest: { gameVersion: string | null, hotfixVersion: number | null },
): Promise<RegionData> {
  const H = { 'Accept-Encoding': 'identity', 'X-Unity-Version': '2022.3.62f2', 'User-Agent': 'UnityPlayer/2022.3.62f2' }
  const [server, notices, launcher, client] = await Promise.allSettled([
    fetchBinary(`${cfg.static}/meta/serverlist.html`, H, 15000).then(b => parseServerList(decrypt(b, cfg.key))),
    fetchBinary(`${cfg.static}/notice/noticelist.html`, H, 15000).then(b => parseNoticeList(decrypt(b, cfg.key))),
    fetchLauncherVersion(cfg),
    previous?.launcherVersion ? fetchClientVersion(cfg, previous.launcherVersion) : Promise.reject(new Error('no launcher version')),
  ])

  if (server.status === 'rejected') throw server.reason
  const s = server.value
  return {
    status: s.status,
    message: s.message,
    patchVersion: s.version || null,
    launcherVersion: launcher.status === 'fulfilled' ? launcher.value : (previous?.launcherVersion ?? null),
    clientVersion: client.status === 'fulfilled' ? client.value : (previous?.clientVersion ?? null),
    gameVersion: manifest.gameVersion ?? previous?.gameVersion ?? null,
    hotfixVersion: manifest.hotfixVersion ?? previous?.hotfixVersion ?? null,
    agents: s.agents,
    notices: notices.status === 'fulfilled' ? normalizeNotices(notices.value) : [],
  }
}

/** 抓取公告正文并缓存 */
async function fillNoticeContent(rows: [string, RegionData][], old: RegionMap<RegionData>, regions: RegionMap<RegionConfig>): Promise<void> {
  const cache = new Map<string, string>()
  for (const groups of Object.values(old)) {
    for (const group of groups?.notices ?? []) {
      for (const item of group.detail ?? []) {
        if (item.contentUrl && item.content) cache.set(item.contentUrl, item.content)
      }
    }
  }

  const queue: { item: { contentUrl: string, content?: string }, cfg: RegionConfig }[] = []
  const seen = new Set<string>()
  for (const [region, d] of rows) {
    const cfg = regions[region]
    for (const group of d.notices ?? []) {
      for (const item of group.detail) {
        if (!item.contentUrl) continue
        if (cache.has(item.contentUrl)) item.content = cache.get(item.contentUrl)
        else if (!seen.has(item.contentUrl)) {
          seen.add(item.contentUrl)
          queue.push({ item, cfg })
        }
      }
    }
  }

  const worker = async () => {
    while (queue.length) {
      const { item, cfg } = queue.shift()!
      try {
        const b = await fetchBinary(`${cfg.static}/notice/${item.contentUrl}`, {}, 20000)
        const text = new TextDecoder().decode(decrypt(b, cfg.key))
        item.content = text
        cache.set(item.contentUrl, text)
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
}

/** 执行一轮完整同步 */
export async function syncStatus(env: Env): Promise<boolean> {
  const { regions, names } = await loadConfig(env)
  const old = await readPrevious(env)
  const manifests: RegionMap<{ gameVersion: string | null, hotfixVersion: number | null }> = {}
  await Promise.all(names.map(async region => {
    try {
      manifests[region] = await fetchManifestVersions(regions[region])
    } catch (err) {
      console.warn(`manifest: ${region} failed -`, err instanceof Error ? err.message : String(err))
    }
  }))

  const entries = await Promise.all(names.map(async region => {
    try {
      const data = await fetchRegion(regions[region], old[region], manifests[region] ?? { gameVersion: null, hotfixVersion: null })
      return [region, data] as [string, RegionData]
    } catch (err) {
      console.warn(`status: ${region} failed -`, err instanceof Error ? err.message : String(err))
      return [region, old[region] ?? null] as [string, RegionData | null]
    }
  }))

  const rows = entries.filter((e): e is [string, RegionData] => e[1] !== null)
  if (rows.length === 0) {
    console.warn('status: all regions failed')
    return false
  }

  await fillNoticeContent(rows, old, regions)

  const updatedAt = new Date().toISOString()
  const statusRegions: RegionMap<Record<string, unknown>> = {}
  const noticeRegions: RegionMap<NoticeGroup[]> = {}
  const agentRegions: RegionMap<RegionData['agents']> = {}
  for (const [region, d] of rows) {
    statusRegions[region] = {
      status: d.status,
      message: d.message,
      patchVersion: d.patchVersion,
      launcherVersion: d.launcherVersion,
      clientVersion: d.clientVersion,
      gameVersion: d.gameVersion,
      hotfixVersion: d.hotfixVersion,
    }
    noticeRegions[region] = d.notices ?? []
    agentRegions[region] = d.agents ?? []
  }

  const statusData: DataSet<Record<string, unknown>> = { updatedAt, regions: statusRegions }
  const noticesData: DataSet<NoticeGroup[]> = { updatedAt, regions: noticeRegions }
  const agentsData: DataSet<RegionData['agents']> = { updatedAt, regions: agentRegions }
  const statusJson = JSON.stringify(statusData)
  const noticesJson = JSON.stringify(noticesData)
  const agentsJson = JSON.stringify(agentsData)
  await Promise.all([
    env.STATUS_KV.put(KV_STATUS, statusJson),
    env.STATUS_KV.put(KV_NOTICES, noticesJson),
    env.STATUS_KV.put(KV_AGENTS, agentsJson),
  ])
  await publishJson(env, { status: statusJson, notices: noticesJson, agents: agentsJson })
  console.log('status: synced', rows.length, 'regions')
  return true
}

/** 同步入口加时间锁避免重复抓取失败时释放锁允许重试 */
export async function runSync(env: Env): Promise<boolean> {
  const last = Number(await env.STATUS_KV.get(KV_LAST_SYNC) ?? 0)
  const now = Date.now()
  if (now - last < MIN_SYNC_INTERVAL) {
    console.log('status: skip, synced', Math.round((now - last) / 1000), 's ago')
    return true
  }
  await env.STATUS_KV.put(KV_LAST_SYNC, String(now))
  try {
    const ok = await syncStatus(env)
    if (!ok) await env.STATUS_KV.put(KV_LAST_SYNC, '0')
    return ok
  } catch (err) {
    await env.STATUS_KV.put(KV_LAST_SYNC, '0')
    throw err
  }
}
