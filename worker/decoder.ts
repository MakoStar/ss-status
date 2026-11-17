import crypto from 'node:crypto'
import zlib from 'node:zlib'

interface Field {
  no: number
  wire: number
  value: bigint | Uint8Array
}

const decoder = new TextDecoder()

/** 读取变长整数返回大整数和位置 */
function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n
  let shift = 0n
  let i = pos
  while (i < buf.length) {
    const byte = buf[i]
    result |= BigInt(byte & 0x7f) << shift
    i++
    if ((byte & 0x80) === 0) break
    shift += 7n
  }
  return [result, i]
}

/** 遍历协议字段 */
function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0
  while (i < buf.length) {
    const [tag, t] = readVarint(buf, i)
    i = t
    const no = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    if (wire === 0) {
      const [v, n] = readVarint(buf, i)
      i = n
      yield { no, wire, value: v }
    } else if (wire === 2) {
      const [len, n] = readVarint(buf, i)
      i = n
      const size = Number(len)
      yield { no, wire, value: buf.subarray(i, i + size) }
      i += size
    } else if (wire === 1) {
      yield { no, wire, value: buf.subarray(i, i + 8) }
      i += 8
    } else if (wire === 5) {
      yield { no, wire, value: buf.subarray(i, i + 4) }
      i += 4
    } else {
      break
    }
  }
}

/** 字段按字符串读取 */
function fieldStr(f: Field): string {
  return f.value instanceof Uint8Array ? decoder.decode(f.value) : ''
}

/** 字段按数字读取 */
function fieldNum(f: Field): number {
  return typeof f.value === 'bigint' ? Number(f.value) : 0
}

/** 字段按字符串化大整数读取 */
function fieldLong(f: Field): string {
  return typeof f.value === 'bigint' ? f.value.toString() : '0'
}

/** 字段按子消息读取 */
function fieldMsg(f: Field): Uint8Array {
  return f.value instanceof Uint8Array ? f.value : new Uint8Array()
}

/** 解密服务端二进制 */
export function decrypt(buf: Uint8Array, key: string): Uint8Array {
  let data = buf
  if (data[0] === 0x1f && data[1] === 0x8b) data = new Uint8Array(zlib.gunzipSync(Buffer.from(data)))
  const input = Buffer.from(data)
  const cipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'ascii'), input.subarray(0, 16))
  cipher.setAutoPadding(false)
  const plain = Buffer.concat([cipher.update(input.subarray(16)), cipher.final()])
  const pad = plain[plain.length - 1]
  if (pad >= 1 && pad <= 16 && plain.subarray(-pad).every((b: number) => b === pad)) {
    return new Uint8Array(plain.subarray(0, -pad))
  }
  let end = plain.length
  while (end > 0 && plain[end - 1] === 0) end--
  return new Uint8Array(plain.subarray(0, end))
}

export interface FileDiffEntry {
  fileName: string
  version: number
  additionalPath: string
}

/** 解析引导清单定位根清单 */
export function parseClientDiff(buf: Uint8Array): FileDiffEntry[] {
  const out: FileDiffEntry[] = []
  for (const top of fields(buf)) {
    if (top.no !== 1) continue
    if (!(top.value instanceof Uint8Array)) continue
    let fileName = ''
    let version = 0
    let additionalPath = ''
    for (const f of fields(top.value)) {
      if (f.no === 1) fileName = fieldStr(f)
      else if (f.no === 3) version = fieldNum(f)
      else if (f.no === 4) additionalPath = fieldStr(f)
    }
    if (fileName) out.push({ fileName, version, additionalPath })
  }
  return out
}

export interface ServerAgent {
  name: string
  addr: string
  status: number
  zone: string
}

export interface ServerListData {
  status: number
  message: string
  version: number
  agents: ServerAgent[]
}

/** 解析区服状态清单 */
export function parseServerList(buf: Uint8Array): ServerListData {
  const out: ServerListData = { status: 0, message: '', version: 0, agents: [] }
  for (const f of fields(buf)) {
    if (f.no === 1) out.version = fieldNum(f)
    else if (f.no === 2) {
      let agent: ServerAgent = { name: '', addr: '', status: 0, zone: '0' }
      let found = false
      for (const a of fields(fieldMsg(f))) {
        found = true
        if (a.no === 1) agent.name = fieldStr(a)
        else if (a.no === 2) agent.addr = fieldStr(a)
        else if (a.no === 3) agent.status = fieldNum(a)
        else if (a.no === 4) agent.zone = fieldLong(a)
      }
      if (found) out.agents.push(agent)
    } else if (f.no === 3) out.status = fieldNum(f)
    else if (f.no === 4) out.message = fieldStr(f)
  }
  return out
}

export interface NoticeItemRaw {
  id: string
  title: string
  contentUrl: string
  endAt: number
  sort: number
}

export interface NoticeGroupRaw {
  name: string
  detail: NoticeItemRaw[]
}

/** 解析公告清单 */
export function parseNoticeList(buf: Uint8Array): NoticeGroupRaw[] {
  const groups: NoticeGroupRaw[] = []
  for (const groupField of fields(buf)) {
    if (groupField.no !== 1) continue
    let name = ''
    const detail: NoticeItemRaw[] = []
    for (const g of fields(fieldMsg(groupField))) {
      if (g.no === 1) name = fieldStr(g)
      else if (g.no === 2) {
        let item: NoticeItemRaw = { id: '', title: '', contentUrl: '', endAt: 0, sort: 0 }
        let found = false
        for (const d of fields(fieldMsg(g))) {
          found = true
          if (d.no === 1) item.id = fieldLong(d)
          else if (d.no === 2) item.title = fieldStr(d)
          else if (d.no === 3) item.contentUrl = fieldStr(d)
          else if (d.no === 6) item.endAt = fieldNum(d)
          else if (d.no === 7) item.sort = fieldNum(d)
        }
        if (found) detail.push(item)
      }
    }
    if (name) groups.push({ name, detail })
  }
  return groups
}
