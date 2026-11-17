interface NoticeItem {
  id: string
  title: string
  contentUrl: string
  endAt: number
  sort: number
  content?: string
}

interface NoticeGroup {
  name: string
  detail: NoticeItem[]
}

interface RegionStatus {
  status: number
  message: string
  patchVersion: number | null
  launcherVersion: string | null
  clientVersion: string | null
  gameVersion: string | null
  hotfixVersion: number | null
}

interface DataSet<T> {
  updatedAt: string
  regions: Record<string, T>
}

interface NoticeEntry {
  key: string
  region: string
  item: NoticeItem
}

type NoticeMap = Record<string, NoticeGroup[]>

const S = {
  status: 'Status', notices: 'Notices', regions: 'Regions', maintenance: 'Maintenance',
  game: 'Game', liveStatus: 'live server status', announcements: 'Announcements',
  activity: 'Events', system: 'System', running: 'Online', down: 'Maintenance',
  updated: 'Last updated', footer: 'data updates every 10 minutes',
  maintenanceMsg: 'Maintenance Message', noNotices: 'No announcements',
  selectNotice: 'Select an announcement', unavailable: 'content unavailable',
}

const get = (id: string): HTMLElement | null => document.getElementById(id)

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function code(value: string | number | null | undefined, prefix = ''): string {
  return value == null || value === ''
    ? '<span style="color:var(--dim)">-</span>'
    : `<code>${prefix}${esc(value)}</code>`
}

function date(seconds: number | undefined): string {
  if (!seconds) return '-'
  const d = new Date(seconds * 1000)
  return Number.isNaN(d.getTime()) ? '-'
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function expiry(seconds: number | undefined): string {
  if (!seconds) return 'Permanent'
  return `Ends ${date(seconds)}`
}

const SAFE_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'U', 'UL',
])
const SAFE_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'title']),
  IMG: new Set(['src', 'alt', 'width', 'height', 'title', 'loading']),
}
const SAFE_LINK = /^(https?:\/\/|mailto:)/i
const SAFE_MEDIA = /^https?:\/\//i
const SAFE_STYLE_PROP = /^(font-size|font-weight|font-style|color|background-color|text-align|text-decoration|line-height|margin|padding|width|height|max-width|white-space|text-indent|border)(-\w+)?\s*:/i
const UNSAFE_STYLE = /(url\s*\(|expression\s*\(|@import|javascript:|data:|behavior\s*:|position\s*:\s*(fixed|absolute|sticky))/i
/** 去掉控制字符避免绕过协议判断 */
const normalizeUrl = (value: string): string => value.replace(/[\u0000-\u0020\u007f]/g, '')

function safeStyle(value: string): string {
  return value.split(';').map(s => s.trim()).filter(s =>
    s.length > 0 && SAFE_STYLE_PROP.test(s) && !UNSAFE_STYLE.test(s),
  ).join('; ')
}

/** 白名单消毒只保留安全标签与属性未知标签降级为纯文本 */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const clean = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove()
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as Element
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') {
        el.remove()
        continue
      }
      if (!SAFE_TAGS.has(el.tagName)) {
        clean(el)
        el.replaceWith(...[...el.childNodes])
        continue
      }
      const allowed = SAFE_ATTRS[el.tagName] ?? new Set<string>()
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        if (name === 'class') {
          if (/^[\w\s-]{1,100}$/.test(value)) continue
        } else if (name === 'style') {
          const css = safeStyle(value)
          if (css) {
            el.setAttribute('style', css)
            continue
          }
        } else if (allowed.has(name)) {
          const url = normalizeUrl(value)
          const goodUrl = name === 'href' ? SAFE_LINK.test(url)
            : name === 'src' ? SAFE_MEDIA.test(url)
            : name !== 'target' || value === '_blank' || value === '_self'
          if (goodUrl) continue
        }
        el.removeAttribute(attr.name)
      }
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer')
      }
      clean(el)
    }
  }
  clean(doc.body)
  return doc.body.innerHTML
}

function renderStatus(status: DataSet<RegionStatus>): void {
  const regions = Object.entries(status.regions ?? {})
  const down = regions.filter(([, d]) => d.status === 1).length
  const games = [...new Set(regions.map(([, d]) => d.gameVersion).filter(Boolean))]
  const game = games.length === 1 ? games[0] : games.length ? 'mixed' : '-'

  const updated = get('updated')
  const badges = get('badges')
  const rows = get('status-rows')
  const messages = get('messages')
  if (!updated || !badges || !rows || !messages) return

  updated.textContent = `${S.updated} · ${status.updatedAt ?? '-'}`
  badges.innerHTML = [
    `<span class="badge">${S.regions} <b>${regions.length}</b></span>`,
    `<span class="badge">${S.maintenance} <b style="color:${down ? 'var(--down)' : 'var(--up)'}">${down}</b></span>`,
    `<span class="badge">${S.game} <b>${esc(game)}</b></span>`,
  ].join('')

  rows.innerHTML = regions.map(([region, d]) => {
    const isDown = d.status === 1
    const state = isDown ? S.down : S.running
    return `<tr>
      <td class="region">${esc(region)}</td>
      <td class="state ${isDown ? 'down' : 'up'}"><span class="dot ${isDown ? 'down' : 'up'}"></span>${esc(state)}</td>
      <td>${code(d.launcherVersion, 'v')}</td>
      <td>${code(d.clientVersion, 'v')}</td>
      <td>${code(d.gameVersion, 'v')}</td>
      <td>${code(d.patchVersion, 'v')}</td>
      <td>${code(d.hotfixVersion, 'p')}</td>
    </tr>`
  }).join('')

  const notices = regions.filter(([, d]) => d.status === 1 && d.message)
  messages.innerHTML = notices.map(([region, d]) =>
    `<div class="msg">
      <h4>${esc(region)} · ${S.maintenanceMsg}</h4>
      <pre>${esc(String(d.message).replace(/\s+/g, ' ').trim())}</pre>
    </div>`
  ).join('')
}

let noticeState: NoticeMap = {}
let noticeRegion = 'CN'
let noticeCategory = 'activity'
let noticeSelected = ''

function noticeEntries(): NoticeEntry[] {
  const regions = noticeRegion === 'ALL' ? Object.keys(noticeState) : [noticeRegion]
  const entries: NoticeEntry[] = []
  for (const region of regions) {
    for (const group of noticeState[region] ?? []) {
      if (group.name !== noticeCategory) continue
      for (const item of group.detail) {
        entries.push({ key: `${region}-${item.id}`, region, item })
      }
    }
  }
  return entries
}

function renderNoticeContent(): void {
  const list = get('notice-list')
  const content = get('notice-content')
  if (!list || !content) return

  const entries = noticeEntries()
  const count = get('board-count')
  if (count) count.textContent = String(entries.length)
  list.innerHTML = entries.map(entry =>
    `<button class="notice-entry${entry.key === noticeSelected ? ' on' : ''}" data-entry="${esc(entry.key)}" title="${esc(entry.item.title)}">
      <span class="notice-entry-title">${esc(entry.item.title)}</span>
    </button>`
  ).join('') || `<div class="missing">${S.noNotices}</div>`

  const current = entries.find(e => e.key === noticeSelected) ?? entries[0]
  if (!current) {
    content.innerHTML = `<div class="missing">${S.selectNotice}</div>`
    content.scrollTop = 0
    return
  }
  noticeSelected = current.key
  list.querySelectorAll<HTMLElement>('[data-entry]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.entry === noticeSelected)
  })

  const body = current.item.content ? sanitize(current.item.content) : ''
  content.innerHTML = `<article class="notice-article">
    <div class="notice-article-head">
      <h2>${esc(current.item.title)}</h2>
      <div class="notice-meta"><span>${esc(current.region)}</span><span>${expiry(current.item.endAt)}</span></div>
    </div>
    <div class="notice-article-body">${body || `<div class="missing">${S.unavailable}</div>`}</div>
  </article>`
  content.scrollTop = 0

  list.querySelectorAll<HTMLElement>('[data-entry]').forEach(btn => {
    btn.addEventListener('click', () => {
      noticeSelected = btn.dataset.entry ?? ''
      renderNoticeContent()
    })
  })
}

function renderNoticeControls(): void {
  const filter = get('notice-filter')
  const tabs = get('notice-tabs')
  if (!filter || !tabs) return

  const regions = Object.keys(noticeState)
  filter.innerHTML = regions.map(r =>
    `<button class="${r === noticeRegion ? 'on' : ''}" data-region="${r}">${esc(r)}</button>`
  ).join('')

  const categories = [...new Set(Object.values(noticeState).flat().map(g => g.name))]
  const categoryLabel: Record<string, string> = { activity: S.activity, system: S.system }
  tabs.innerHTML = categories.map(name =>
    `<button class="board-tab${name === noticeCategory ? ' on' : ''}" data-category="${esc(name)}">${esc(categoryLabel[name] ?? name)}</button>`
  ).join('')

  filter.querySelectorAll<HTMLElement>('[data-region]').forEach(btn => {
    btn.addEventListener('click', () => {
      noticeRegion = btn.dataset.region ?? 'CN'
      noticeSelected = ''
      renderNoticeControls()
      renderNoticeContent()
    })
  })
  tabs.querySelectorAll<HTMLElement>('[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      noticeCategory = btn.dataset.category ?? 'activity'
      noticeSelected = ''
      renderNoticeControls()
      renderNoticeContent()
    })
  })
}

function renderNotices(): void {
  if (!Object.keys(noticeState).length) return
  if (!noticeState[noticeRegion]) noticeRegion = Object.keys(noticeState)[0]
  const title = get('board-title')
  if (title) title.textContent = S.announcements
  renderNoticeControls()
  renderNoticeContent()
}

function initTheme(): void {
  const btn = get('theme-toggle')
  const saved = localStorage.getItem('ss-theme')
  const theme = saved === 'light' || saved === 'dark' ? saved : 'dark'
  const paint = (value: string): void => {
    document.documentElement.dataset.theme = value
    if (btn) btn.textContent = value === 'dark' ? '☀️' : '🌙'
  }
  paint(theme)
  btn?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('ss-theme', next)
    paint(next)
  })
}

function showPage(page: string): void {
  document.querySelectorAll<HTMLElement>('[data-page]')
    .forEach(t => t.classList.toggle('on', t.dataset.page === page))
  document.querySelectorAll<HTMLElement>('[data-panel]')
    .forEach(p => { p.hidden = p.dataset.panel !== page })
}

function bindTabs(): void {
  document.querySelectorAll<HTMLElement>('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page ?? 'status'
      showPage(page)
      history.replaceState(null, '', `#${page}`)
    })
  })
  const initial = location.hash.replace('#', '')
  if (initial) showPage(initial)
}

/** 数据放独立分支页面只部署一次双路竞速累积最新版本同源快照兜底 */
async function loadJson<T extends { updatedAt?: string }>(name: string, onData: (data: T) => void): Promise<T> {
  const t = `?t=${Date.now()}`
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const sources = [
    `https://raw.githubusercontent.com/MakoStar/ss-status/data/${name}${t}`,
    `https://cdn.jsdelivr.net/gh/MakoStar/ss-status@data/${name}${t}`,
  ]
  let best: T | null = null
  /** 每路到达即累积最新版本渐进刷新先快后准 */
  const pending = sources.map(async url => {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as T
    best = best && (best.updatedAt ?? '') >= (data.updatedAt ?? '') ? best : data
    onData(best)
    return data
  })
  try {
    return await Promise.any(pending)
  } catch {
    const res = await fetch(`${base}/${name}${t}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error('all sources failed')
    const data = await res.json() as T
    onData(data)
    return data
  }
}

let cache: { status: DataSet<RegionStatus>, notices: DataSet<NoticeGroup[]> } | null = null

function renderStatusPart(data: DataSet<RegionStatus>): void {
  if (!cache) cache = { status: data, notices: { updatedAt: '', regions: {} } }
  else cache.status = data
  renderStatus(cache.status)
}

function renderNoticesPart(data: DataSet<NoticeGroup[]>): void {
  if (!cache) cache = { status: { updatedAt: '', regions: {} }, notices: data }
  else cache.notices = data
  noticeState = data.regions ?? {}
  renderNotices()
}

export async function load(): Promise<void> {
  initTheme()
  bindTabs()
  const grid = get('status-rows')
  try {
    await Promise.all([
      loadJson<DataSet<RegionStatus>>('status.json', renderStatusPart),
      loadJson<DataSet<NoticeGroup[]>>('notices.json', renderNoticesPart),
    ])
  } catch (err) {
    if (grid) {
      grid.innerHTML = `<tr><td colspan="7" class="err">Failed to load data · ${esc(err instanceof Error ? err.message : err)}
        <br><button onclick="location.reload()">Retry</button></td></tr>`
    }
  }
}
