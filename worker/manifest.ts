import { decrypt, parseClientDiff } from './decoder'
import type { RegionConfig } from './types'

const HEADERS = {
  'Accept-Encoding': 'identity',
  'X-Unity-Version': '2022.3.62f2',
  'User-Agent': 'UnityPlayer/2022.3.62f2',
}

/** 带超时的二进制请求 */
async function fetchBinary(url: string, retries = 2): Promise<Uint8Array> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw lastErr
}

/** 解析清单文本版本字段 */
function parseMani(text: string): { gameVersion: string | null, hotfixVersion: number | null } {
  const clean = text.replace(/\r/g, '')
  const game = clean.match(/^\$GAME_VER:(.+)$/m)?.[1].trim() ?? null
  const hotfixRaw = clean.match(/^\$BIN_DIFF_PATCH_VER:(\d+)$/m)?.[1]
  return { gameVersion: game, hotfixVersion: hotfixRaw == null ? null : Number(hotfixRaw) }
}

/** 用纯脚本获取区服版本 */
export async function fetchManifestVersions(cfg: RegionConfig) {
  const bootstrap = await fetchBinary(`${cfg.static}/meta/win.html`)
  const plain = decrypt(bootstrap, cfg.key)
  const entries = parseClientDiff(plain)
  const root = entries.find(e => e.fileName === 'ss_win.mani')
  if (!root || !root.version) throw new Error('ss_win.mani entry missing')
  const url = `${cfg.static}/res/win/${root.version}/${root.additionalPath}/ss_win.mani`
  const mani = await fetchBinary(url)
  const text = new TextDecoder().decode(mani)
  return parseMani(text)
}
