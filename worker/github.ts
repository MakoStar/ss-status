import type { Env } from './types'

const OWNER = 'MakoStar'
const REPO = 'ss-status'
const BRANCH = 'data'
const FILES = ['status', 'notices', 'agents']
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

interface BranchHead {
  parent: string
  tree: string
}

function request(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ss-status-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  })
}

/** 读取响应出错时带上接口返回的具体原因 */
async function readJson<T>(res: Response, label: string): Promise<T> {
  if (res.ok) return await res.json() as T
  const text = await res.text().catch(() => '')
  let detail = text
  try {
    const body = JSON.parse(text) as { message?: string, errors?: unknown[] }
    detail = body.message ?? text
    if (body.errors?.length) detail += ` ${JSON.stringify(body.errors)}`
  } catch {}
  throw new Error(`github ${label} HTTP ${res.status}: ${detail}`)
}

/** 为每个文件创建对象并返回树条目 */
async function createEntries(token: string, files: { path: string, content: string }[]) {
  return await Promise.all(files.map(async file => {
    const blob = await readJson<{ sha: string }>(
      await request('/git/blobs', token, {
        method: 'POST',
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      }), `blob create ${file.path}`,
    )
    return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha }
  }))
}

/** 获取已有数据分支的当前提交与树 */
async function readBranch(token: string): Promise<BranchHead | null> {
  const res = await request(`/branches/${BRANCH}`, token)
  if (res.status === 404) return null
  const head = await readJson<{ commit: { sha: string, commit: { tree: { sha: string } } } }>(res, 'branch')
  return { parent: head.commit.sha, tree: head.commit.commit.tree.sha }
}

/** 写数据到独立分支不触碰页面部署分支 */
export async function publishJson(env: Env, data: Record<string, string>): Promise<void> {
  const token = env.GITHUB_TOKEN
  if (!token) throw new Error('github: token missing')

  try {
    const files = FILES.filter(name => data[name]).map(name => ({ path: `${name}.json`, content: data[name] }))
    if (!files.length) throw new Error('github no data')
    const entries = await createEntries(token, files)
    const head = await readBranch(token)

    const tree = await readJson<{ sha: string }>(
      await request('/git/trees', token, {
        method: 'POST',
        body: JSON.stringify(head ? { base_tree: head.tree, tree: entries } : { tree: entries }),
      }), head ? 'tree create' : 'init tree',
    )
    const commit = await readJson<{ sha: string }>(
      await request('/git/commits', token, {
        method: 'POST',
        body: JSON.stringify({
          message: `status: update data ${new Date().toISOString()}`,
          tree: tree.sha,
          parents: head ? [head.parent] : [],
        }),
      }), 'commit create',
    )
    const ref = await request(head ? `/git/refs/heads/${BRANCH}` : '/git/refs', token, {
      method: head ? 'PATCH' : 'POST',
      body: JSON.stringify(head ? { sha: commit.sha } : { ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
    })
    if (!ref.ok && !(ref.status === 422 && !head)) throw new Error(`github ref HTTP ${ref.status}`)

    console.log('github: updated data branch', files.map(f => f.path).join(', '))
  } catch (err) {
    throw new Error(`github writeback failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
