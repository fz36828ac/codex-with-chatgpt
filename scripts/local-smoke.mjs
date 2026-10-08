// Exercise the built CLI and a real detached daemon; never starts a public tunnel.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readRuntimeState } from '../dist/bridge/runtime.js';
import { adminFetch } from '../dist/process/daemon.js';
import { getStateDir } from '../dist/config/paths.js';

const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  workspace: { type: 'string', default: repo },
  report: { type: 'string' },
  'keep-running': { type: 'boolean', default: false },
} });
const root = path.resolve(values.workspace);
const cliPath = path.join(repo, 'bin/c2c.js');
const checks = [];
let base, runtime, fixture, client, originalPid, finalStatus;
let started = false;
let mayRevoke = false;
let successful = false;
const cli = async (...args) => (await exec(process.execPath, [cliPath, ...args, '-w', root], { cwd: repo, timeout: 30_000 })).stdout;
const cliJson = async (...args) => JSON.parse(await cli(...args, '--json'));
const verify = async (name, action) => { await action(); checks.push({ name, passed: true }); };
const post = (route, body) => fetch(base + route, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'manual',
});
const toolError = async (name, args, code) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  assert.ok(result.content[0].text.includes(code));
};
const connect = async (token) => {
  const result = new Client({ name: 'c2c-local-deployment-check', version: '1.0.0' });
  await result.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return result;
};

async function authorize(scope) {
  const pairing = await adminFetch(runtime, 'POST', '/admin/pairing');
  const registration = await fetch(base + '/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Local deployment check', redirect_uris: ['http://127.0.0.1:19999/callback'] }),
  });
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ client_id, redirect_uri: 'http://127.0.0.1:19999/callback', response_type: 'code',
    state: 'local-check', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope });
  const page = await fetch(base + '/oauth/authorize?' + query);
  assert.equal(page.status, 200);
  const request_id = (await page.text()).match(/name="request_id" value="([a-f0-9]+)"/)?.[1];
  assert.ok(request_id);
  const redirect = await post('/oauth/authorize', { request_id, pairing_code: pairing.code });
  assert.equal(redirect.status, 302);
  const location = new URL(redirect.headers.get('location'));
  assert.equal(location.searchParams.get('state'), 'local-check');
  const grant = { grant_type: 'authorization_code', code: location.searchParams.get('code'), code_verifier: verifier,
    client_id, redirect_uri: 'http://127.0.0.1:19999/callback' };
  const response = await post('/oauth/token', grant);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal((await post('/oauth/token', grant)).status, 400);
  return { ...tokens, client_id };
}

try {
  await verify('built CLI starts a detached local daemon', async () => {
    const previous = await cliJson('status');
    assert.ok(!previous.running || previous.tokenCount === 0, 'Use an unpaired workspace for this smoke check.');
    assert.ok(!previous.running || !previous.tunnel.running, 'Use a local-only workspace for this smoke check.');
    const status = await cliJson('start');
    assert.equal(status.ok, true);
    started = !previous.running;
    runtime = readRuntimeState(status.workspaceId);
    assert.ok(runtime);
    originalPid = runtime.pid;
    base = `http://127.0.0.1:${status.port}`;
    const info = await adminFetch(runtime, 'GET', '/admin/info');
    assert.equal(info.tokenCount, 0);
    mayRevoke = true;
    assert.equal(info.tunnel.running, false);
  });
  await verify('health endpoint identifies the deployed workspace', async () => {
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.workspaceId, runtime.workspaceId);
  });
  if (process.platform === 'darwin') await verify('daemon listens on 127.0.0.1 only', async () => {
    const { stdout } = await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(runtime.pid), '-iTCP', '-sTCP:LISTEN']);
    assert.ok(stdout.includes(`127.0.0.1:${runtime.port}`));
    assert.ok(!stdout.includes(`*:${runtime.port}`));
  });
  await verify('unauthenticated MCP and admin requests are rejected', async () => {
    assert.equal((await fetch(base + '/mcp')).status, 401);
    assert.equal((await fetch(base + '/admin/info')).status, 404);
    assert.equal((await fetch(base + '/admin/info', { headers: {
      authorization: `Bearer ${runtime.adminToken}`, 'x-forwarded-for': '198.51.100.1',
    } })).status, 404);
  });
  let tokens;
  await verify('real OAuth pairing, PKCE, and one-time authorization code', async () => {
    tokens = await authorize('workspace.read workspace.search git.read execution.read offline_access');
    client = await connect(tokens.access_token);
  });
  await verify('exactly ten read-only MCP tools are exposed', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['execution_output', 'execution_summary', 'git_diff', 'git_status',
      'list_directory', 'read_file', 'read_image', 'search_workspace', 'test_status', 'workspace_info'].sort());
    assert.ok(tools.every(t => t.annotations.readOnlyHint === true));
  });
  await verify('MCP reads the actual deployed README', async () => {
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'README.md' } });
    assert.ok(!result.isError);
    assert.ok(JSON.parse(result.content[0].text).content.includes('Codex with ChatGPT'));
  });
  await verify('Git metadata, sensitive files, and traversal stay blocked', async () => {
    await toolError('read_file', { path: '.git/config' }, 'ACCESS_DENIED_SENSITIVE_FILE');
    await toolError('read_file', { path: '.env' }, 'ACCESS_DENIED_SENSITIVE_FILE');
    await toolError('list_directory', { path: '.git' }, 'ACCESS_DENIED_SENSITIVE_FILE');
    await toolError('search_workspace', { path: '.git', query: 'credential' }, 'ACCESS_DENIED_SENSITIVE_FILE');
    await toolError('read_file', { path: '../../outside' }, 'PATH_OUTSIDE_WORKSPACE');
  });
  const parent = path.join(root, '.tooling');
  await fs.mkdir(parent, { recursive: true });
  fixture = await fs.mkdtemp(path.join(parent, 'local-smoke-'));
  const relativeFixture = path.relative(root, fixture).split(path.sep).join('/');
  await verify('oversized lines and files return bounded errors over HTTP', async () => {
    await fs.writeFile(path.join(fixture, 'long.txt'), 'x'.repeat(2 * 1024 * 1024));
    await fs.writeFile(path.join(fixture, 'large.txt'), 'ok\n');
    await fs.truncate(path.join(fixture, 'large.txt'), 16 * 1024 * 1024 + 1);
    await toolError('read_file', { path: relativeFixture + '/long.txt' }, 'FILE_TOO_LARGE');
    await toolError('read_file', { path: relativeFixture + '/large.txt' }, 'FILE_TOO_LARGE');
  });
  await verify('normal file pagination advances correctly', async () => {
    await fs.writeFile(path.join(fixture, 'pages.txt'), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));
    const result = await client.callTool({ name: 'read_file', arguments: { path: relativeFixture + '/pages.txt' } });
    const first = JSON.parse(result.content[0].text);
    assert.equal(first.nextStartLine, 401);
    assert.equal(first.endLine, 400);
    assert.ok(Buffer.byteLength(first.content) <= 256 * 1024);
    const next = await client.callTool({ name: 'read_file', arguments: { path: relativeFixture + '/pages.txt', start_line: first.nextStartLine } });
    assert.ok(JSON.parse(next.content[0].text).content.startsWith('line 401\n'));
  });
  await verify('read-only token cannot invoke search without its scope', async () => {
    const restricted = await authorize('workspace.read');
    const scopedClient = await connect(restricted.access_token);
    try {
      const result = await scopedClient.callTool({ name: 'search_workspace', arguments: { query: 'Codex' } });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('INSUFFICIENT_SCOPE'));
    } finally { await scopedClient.close(); }
  });
  await verify('daemon restart restores OAuth state and file access', async () => {
    await client.close();
    client = null;
    await cli('restart');
    const status = await cliJson('status');
    assert.equal(status.running, true);
    assert.notEqual(status.pid, originalPid);
    runtime = readRuntimeState(status.workspaceId);
    base = `http://127.0.0.1:${status.port}`;
    client = await connect(tokens.access_token);
    assert.ok(!(await client.callTool({ name: 'workspace_info', arguments: {} })).isError);
  });
  await verify('refresh tokens rotate and cannot be replayed', async () => {
    const form = { grant_type: 'refresh_token', client_id: tokens.client_id, refresh_token: tokens.refresh_token };
    const response = await post('/oauth/token', form);
    assert.equal(response.status, 200);
    const refreshed = await response.json();
    assert.ok(refreshed.refresh_token !== tokens.refresh_token);
    assert.equal((await post('/oauth/token', form)).status, 400);
  });
  await verify('credential files are owner-only and access tokens are hashed', async () => {
    const authPath = path.join(getStateDir(), 'auth', runtime.workspaceId + '.json');
    const raw = await fs.readFile(authPath, 'utf8');
    assert.ok(!raw.includes(tokens.access_token));
    assert.ok(!raw.includes(tokens.refresh_token));
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(authPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(path.join(getStateDir(), 'runtime', runtime.workspaceId + '.json'))).mode & 0o777, 0o600);
    }
  });
  await verify('revocation immediately denies the previous access token', async () => {
    await adminFetch(runtime, 'POST', '/admin/revoke-all');
    assert.equal((await fetch(base + '/mcp', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 401);
    assert.equal((await adminFetch(runtime, 'GET', '/admin/info')).tokenCount, 0);
  });
  successful = true;
} finally {
  await client?.close().catch(() => {});
  if (mayRevoke) await adminFetch(runtime, 'POST', '/admin/revoke-all').catch(() => {});
  if (fixture) await fs.rm(fixture, { recursive: true, force: true });
  if (started && (!values['keep-running'] || !successful)) await cli('stop').catch(() => {});
}
finalStatus = await cliJson('status');
const report = { checkedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  commit: (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim(),
  checks, running: finalStatus.running, localUrl: finalStatus.running ? `http://127.0.0.1:${finalStatus.port}/mcp` : null,
  publicTunnelEnabled: false, chatgptAccountConnected: false, remainingTestTokens: finalStatus.tokenCount ?? 0 };
if (values.report) await fs.writeFile(path.resolve(values.report), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
