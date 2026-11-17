export interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export interface Env {
  STATUS_KV: KVNamespace
  API_TOKEN?: string
  GITHUB_TOKEN?: string
}

export interface RegionConfig {
  static: string
  key: string
  launcher: string
  pkg: string
  tag: string
  salt: string
}

export interface NoticeItem {
  id: string
  title: string
  contentUrl: string
  endAt: number
  sort: number
  content?: string
}

export interface NoticeGroup {
  name: string
  detail: NoticeItem[]
}

export interface RegionData {
  status: number
  message: string
  patchVersion: number | null
  launcherVersion: string | null
  clientVersion: string | null
  gameVersion: string | null
  hotfixVersion: number | null
  agents: { name: string, addr: string, status: number, zone: string }[]
  notices: NoticeGroup[]
}

export type RegionMap<T> = Record<string, T>

export interface DataSet<T> {
  updatedAt: string
  regions: RegionMap<T>
}
