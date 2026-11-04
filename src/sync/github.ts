/**
 * 信息汇总工作台 · GitHub Contents API 客户端（架构第 4 章）
 *
 * 关键约定：
 *   · 令牌只作为请求头使用，不进 URL、不进日志、不进错误信息
 *   · 写回必须携带上次读到的 blob sha（乐观锁），否则会静默覆盖他人提交
 *   · 5xx / 网络错误 / 429 指数退避重试（1s → 2s → 4s，最多 3 次）
 *   · 401 / 403 / 404 / 422 不重试，直接给出可执行的提示
 *   · 409 不是错误，是并发信号 → 交由冲突分支处理
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GithubClientOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** 注入 fetch，便于单测 mock；默认使用全局 fetch */
  fetchImpl?: FetchLike;
  /** 注入 sleep，便于单测控制退避时间 */
  sleepImpl?: (ms: number) => Promise<void>;
}

export class GithubError extends Error {
  status: number;
  kind: 'auth' | 'notfound' | 'invalid' | 'conflict' | 'rate' | 'server' | 'network';
  retryable: boolean;

  constructor(message: string, status: number, kind: GithubError['kind'], retryable: boolean) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface RemoteFile {
  path: string;
  sha: string;
  content: string;
  size: number;
}

export interface PutResult {
  sha: string;
  commitSha: string;
}

const API_ROOT = 'https://api.github.com';
const RETRY_DELAYS = [1000, 2000, 4000];
const MAX_ATTEMPTS = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** UTF-8 安全 base64 编码（btoa 只接受 Latin1，需先转字节） */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → UTF-8 文本 */
export function fromBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 解析仓库地址：接受 https://github.com/owner/repo、owner/repo、完整 URL */
export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  // 先去掉末尾斜杠，再去 .git 后缀——顺序反了会漏掉 "repo.git/" 这种写法
  const s = String(input ?? '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (!s) return null;
  const m = s.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
  if (m) return { owner: m[1], repo: m[2] };
  const simple = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (simple) return { owner: simple[1], repo: simple[2] };
  return null;
}

export class GithubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(opts: GithubClientOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch || 'main';
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private url(path: string): string {
    return `${API_ROOT}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  /** 统一的请求执行 + 错误分类 + 重试 */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let lastError: GithubError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        // 网络错误 / 浏览器离线
        lastError = new GithubError(
          '网络不可达或请求被中断，请检查网络连接后重试',
          0,
          'network',
          true,
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          await this.sleepImpl(RETRY_DELAYS[attempt]);
          continue;
        }
        throw lastError;
      }

      if (res.ok) return res;

      const detail = await safeMessage(res);
      const error = classify(res.status, detail);
      if (!error.retryable || attempt === MAX_ATTEMPTS - 1) throw error;
      lastError = error;
      await this.sleepImpl(RETRY_DELAYS[attempt]);
    }

    throw lastError ?? new GithubError('请求失败', 0, 'network', false);
  }

  /** 读取仓库中的文件 */
  async getFile(path: string): Promise<RemoteFile> {
    const url = `${this.url(path)}?ref=${encodeURIComponent(this.branch)}`;
    const res = await this.request(url, { method: 'GET', headers: this.headers() });
    const data = (await res.json()) as {
      content?: string;
      encoding?: string;
      sha?: string;
      size?: number;
      path?: string;
    };
    if (!data.content || !data.sha) {
      throw new GithubError('远端返回内容为空或格式不符', 0, 'invalid', false);
    }
    return {
      path: data.path ?? path,
      sha: data.sha,
      content: fromBase64(data.content),
      size: data.size ?? 0,
    };
  }

  /** 写回文件。sha 为乐观锁参数：传远端当前 sha 做更新；传 null 表示新建文件（v6.2：plans.json 首次落仓）。 */
  async putFile(path: string, content: string, sha: string | null, message: string): Promise<PutResult> {
    const body = JSON.stringify({
      message,
      content: toBase64(content),
      ...(sha ? { sha } : {}),
      branch: this.branch,
    });
    const res = await this.request(this.url(path), { method: 'PUT', headers: this.headers(), body });
    const data = (await res.json()) as { content?: { sha?: string }; commit?: { sha?: string } };
    if (!data.content?.sha) {
      throw new GithubError('写回成功但未返回新 sha', 0, 'invalid', false);
    }
    return { sha: data.content.sha, commitSha: data.commit?.sha ?? '' };
  }

  /** 轻量连通性检测（读取仓库元信息） */
  async checkConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const url = `${API_ROOT}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
      const res = await this.fetchImpl(url, { method: 'GET', headers: this.headers() });
      if (res.ok) return { ok: true, message: '已连接' };
      const detail = await safeMessage(res);
      const err = classify(res.status, detail);
      return { ok: false, message: err.message };
    } catch {
      return { ok: false, message: '网络不可达，请检查网络连接' };
    }
  }
}

/** 按状态码归类错误（架构 4.5 失败处理表） */
export function classify(status: number, detail: string): GithubError {
  if (status === 401) {
    return new GithubError('令牌无效或已过期，请到设置页重新粘贴令牌', status, 'auth', false);
  }
  if (status === 403) {
    return new GithubError('令牌权限不足：需要目标仓库的 Contents 读写权限', status, 'auth', false);
  }
  if (status === 404) {
    return new GithubError('找不到仓库或文件，请检查仓库地址、分支与文件路径', status, 'notfound', false);
  }
  if (status === 422) {
    return new GithubError(`提交被拒绝：${detail || '参数校验未通过'}`, status, 'invalid', false);
  }
  if (status === 409) {
    if (detail.includes('push protection')) {
      return new GithubError('内容被 GitHub 推送保护拦截，请检查是否误把令牌写入了数据文件', status, 'conflict', false);
    }
    return new GithubError('远端文件已被更新，需要先处理冲突', status, 'conflict', false);
  }
  if (status === 429) {
    return new GithubError('请求过于频繁，正在重试', status, 'rate', true);
  }
  if (status >= 500) {
    return new GithubError(`GitHub 服务暂时不可用（${status}），正在重试`, status, 'server', true);
  }
  return new GithubError(`请求失败（${status}）：${detail}`, status, 'invalid', false);
}

/** 读取 GitHub 错误信息（不打印令牌） */
async function safeMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data.message ?? '';
  } catch {
    return '';
  }
}
