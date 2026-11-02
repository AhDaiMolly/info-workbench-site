import { describe, expect, it } from 'vitest';
import {
  GithubClient, GithubError, classify, fromBase64, parseRepoUrl, toBase64,
} from '../sync/github';

/**
 * 说明：本文件不接触真实 GitHub，全部使用 mock fetch。
 * 因此「GitHub API 读写」标记为 未在真实 GitHub 环境验证。
 */

interface MockCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(handler: (call: MockCall, attempt: number) => Response | Promise<Response>) {
  const calls: MockCall[] = [];
  const sleeps: number[] = [];
  let attempt = 0;
  const client = new GithubClient({
    owner: 'example',
    repo: 'data',
    branch: 'main',
    token: 'test-token-value-not-a-real-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      attempt += 1;
      const res = await handler({ url, init }, attempt);
      if (!(res instanceof Response)) throw res;
      return res;
    },
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });
  return { client, calls, sleeps, attempts: () => attempt };
}

describe('base64 编解码（UTF-8 安全）', () => {
  it('中文与 emoji 往返一致', () => {
    const text = '信息汇总工作台 · 记录 1 ✅';
    expect(fromBase64(toBase64(text))).toBe(text);
  });

  it('空串往返一致', () => {
    expect(fromBase64(toBase64(''))).toBe('');
  });
});

describe('仓库地址解析', () => {
  it('解析完整 URL', () => {
    expect(parseRepoUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('解析 owner/repo 简写', () => {
    expect(parseRepoUrl('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('去掉 .git 后缀与末尾斜杠', () => {
    expect(parseRepoUrl('https://github.com/owner/repo.git/')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('非法输入返回 null', () => {
    expect(parseRepoUrl('')).toBeNull();
    expect(parseRepoUrl('   ')).toBeNull();
  });
});

describe('错误分类（架构 4.5）', () => {
  it('401 → 令牌问题，不重试', () => {
    const e = classify(401, 'Bad credentials');
    expect(e.kind).toBe('auth');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('令牌');
  });

  it('403 → 权限不足，不重试', () => {
    const e = classify(403, 'Forbidden');
    expect(e.kind).toBe('auth');
    expect(e.retryable).toBe(false);
  });

  it('404 → 找不到，不重试', () => {
    const e = classify(404, 'Not Found');
    expect(e.kind).toBe('notfound');
    expect(e.retryable).toBe(false);
  });

  it('422 → 提交被拒，不重试', () => {
    const e = classify(422, 'invalid sha');
    expect(e.kind).toBe('invalid');
    expect(e.retryable).toBe(false);
  });

  it('409 → 并发冲突信号，不重试', () => {
    const e = classify(409, 'conflict');
    expect(e.kind).toBe('conflict');
    expect(e.retryable).toBe(false);
  });

  it('409 且命中 push protection → 给出可执行提示', () => {
    const e = classify(409, 'push protection is enabled');
    expect(e.message).toContain('推送保护');
  });

  it('429 与 5xx → 可重试', () => {
    expect(classify(429, '').retryable).toBe(true);
    expect(classify(500, '').retryable).toBe(true);
    expect(classify(503, '').retryable).toBe(true);
  });
});

describe('GithubClient 读取', () => {
  it('成功读取并返回 sha 与内容', async () => {
    const content = JSON.stringify({ records: [] });
    const { client, calls } = makeClient(() =>
      jsonResponse(200, {
        content: toBase64(content),
        encoding: 'base64',
        sha: 'sha-1',
        size: content.length,
        path: 'data/records.json',
      }));
    const file = await client.getFile('data/records.json');
    expect(file.sha).toBe('sha-1');
    expect(file.content).toBe(content);
    expect(calls[0].url).toContain('/repos/example/data/contents/data/records.json');
    expect(calls[0].url).toContain('ref=main');
  });

  it('令牌只出现在 Authorization 头，不进 URL', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, { content: toBase64('{}'), sha: 's', size: 2 }));
    await client.getFile('data/records.json');
    expect(calls[0].url).not.toContain('test-token-value-not-a-real-token');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token-value-not-a-real-token');
  });

  it('404 抛出不可重试的 GithubError', async () => {
    const { client, calls } = makeClient(() => jsonResponse(404, { message: 'Not Found' }));
    await expect(client.getFile('data/records.json')).rejects.toBeInstanceOf(GithubError);
    expect(calls.length).toBe(1);
  });

  it('远端返回空内容时报错而非静默返回空', async () => {
    const { client } = makeClient(() => jsonResponse(200, { content: '', sha: 's' }));
    await expect(client.getFile('data/records.json')).rejects.toThrow(/格式不符|为空/);
  });
});

describe('GithubClient 写回（乐观锁）', () => {
  it('请求体携带 sha 与 base64 内容', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse(200, { content: { sha: 'new-sha' }, commit: { sha: 'commit-sha' } }));
    const res = await client.putFile('data/records.json', '{"a":1}', 'old-sha', '提交信息');
    expect(res.sha).toBe('new-sha');
    expect(res.commitSha).toBe('commit-sha');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.sha).toBe('old-sha');
    expect(body.branch).toBe('main');
    expect(body.message).toBe('提交信息');
    expect(fromBase64(body.content)).toBe('{"a":1}');
  });

  it('缺 sha 时远端拒绝（模拟 422）且不重试', async () => {
    const { client, calls } = makeClient(() => jsonResponse(422, { message: 'sha is required' }));
    await expect(client.putFile('data/records.json', '{}', '', 'msg')).rejects.toBeInstanceOf(GithubError);
    expect(calls.length).toBe(1);
  });
});

describe('重试与降级', () => {
  it('5xx 指数退避重试 3 次后仍失败', async () => {
    const { client, calls, sleeps } = makeClient(() => jsonResponse(500, { message: 'boom' }));
    await expect(client.getFile('data/records.json')).rejects.toBeInstanceOf(GithubError);
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('第 2 次成功则不再继续重试', async () => {
    let n = 0;
    const { client, calls, sleeps } = makeClient(() => {
      n += 1;
      if (n === 1) return jsonResponse(503, { message: 'later' });
      return jsonResponse(200, { content: toBase64('ok'), sha: 's2', size: 2 });
    });
    const file = await client.getFile('data/records.json');
    expect(file.sha).toBe('s2');
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('网络异常（fetch 抛错）按网络错误重试并最终抛出', async () => {
    const { client, calls, sleeps } = makeClient(() => { throw new TypeError('Failed to fetch'); });
    await expect(client.getFile('data/records.json')).rejects.toThrow(/网络不可达/);
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('连通性检测：成功与 401 两种结果', async () => {
    const ok = makeClient(() => jsonResponse(200, { full_name: 'owner/data' }));
    expect((await ok.client.checkConnection()).ok).toBe(true);

    const bad = makeClient(() => jsonResponse(401, { message: 'Bad credentials' }));
    const r = await bad.client.checkConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('令牌');
  });
});
