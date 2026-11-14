import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { fixture, issue, TEST_TARGET } from './fixtures.js';
import { gitLabTargetKey } from '../shared/types.js';
import { ServiceError } from '../server/glab.js';
import { ApplicationUpdates } from '../server/updates.js';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function setup(lanAddresses: string[] = []) {
  const service = { workspace: vi.fn(async () => fixture()), issue: vi.fn(async () => issue(1)),
    update: vi.fn(async () => issue(1)), connect: vi.fn(async () => fixture()),
    creationOptions: vi.fn(async () => ({ source: issue(1), canCreateSubtask: true, canCreateIssue: true })),
    createConnected: vi.fn(async () => ({ workspace: fixture(), createdIid: '9' })),
    createIssue: vi.fn(async () => ({ workspace: fixture(), createdIid: '9' })) };
  const imageLoader = vi.fn(async () => ({ body: Buffer.from('image bytes'), contentType: 'image/png' }));
  const app = createApp(service, { lanAddresses, imageLoader, target: TEST_TARGET }); apps.push(app);
  return { app, service, imageLoader };
}
const headers = { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310',
  'x-ticketmap-target': gitLabTargetKey(TEST_TARGET) };
const payload = { expectedUpdatedAt: issue(1).updatedAt, title: 'New title' };

describe('local API boundary', () => {
  it('serves portable health and update metadata without accessing GitLab or accepting another origin', async () => {
    const { service, imageLoader } = setup();
    const fetchRelease = vi.fn(async () => Response.json({ draft: false, prerelease: false,
      tag_name: 'v0.3.0', html_url: 'https://github.com/example/ticket-map/releases/tag/v0.3.0' }));
    const app = createApp(service, { imageLoader, target: TEST_TARGET, port: 4311, developmentOrigins: false,
      updates: new ApplicationUpdates({ version: '0.2.0', repository: 'example/ticket-map' }, fetchRelease) });
    apps.push(app);
    const host = { host: '127.0.0.1:4311' };
    const info = await app.inject({ method: 'GET', url: '/api/app-info', headers: host });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({ application: 'TicketMap', version: '0.2.0' });
    const update = await app.inject({ method: 'GET', url: '/api/app-update', headers: host });
    expect(update.json()).toMatchObject({ currentVersion: '0.2.0', available: true, latestVersion: '0.3.0' });
    expect(service.workspace).not.toHaveBeenCalled();
    for (const denied of [{ host: '127.0.0.1:4310' }, { host: '192.168.1.10:4311' },
      { ...host, origin: 'http://127.0.0.1:5173' }, { ...host, origin: 'https://attacker.example' }]) {
      const response = await app.inject({ method: 'GET', url: '/api/app-info', headers: denied });
      expect(response.statusCode).toBe(403);
    }
  });
  it('accepts normalized HTTP origins on the default HTTP port', async () => {
    const { service, imageLoader } = setup();
    const app = createApp(service, { imageLoader, target: TEST_TARGET, port: 80, developmentOrigins: false });
    apps.push(app);
    for (const host of ['127.0.0.1', '127.0.0.1:80']) {
      const response = await app.inject({ method: 'PATCH', url: '/api/issues/1',
        headers: { ...headers, host, origin: 'http://127.0.0.1' }, payload });
      expect(response.statusCode).toBe(200);
    }
    const denied = await app.inject({ method: 'PATCH', url: '/api/issues/1',
      headers: { ...headers, host: '127.0.0.1', origin: 'http://127.0.0.1:4310' }, payload });
    expect(denied.statusCode).toBe(403);
    expect(service.update).toHaveBeenCalledTimes(2);
  });
  it('rejects missing and stale host/project target assertions before a mutation', async () => {
    const { app, service } = setup();
    for (const key of [undefined, gitLabTargetKey({ ...TEST_TARGET, project: 'other/project' }),
      gitLabTargetKey({ ...TEST_TARGET, gitlabUrl: 'https://other.example.com' })]) {
      const response = await app.inject({ method: 'PATCH', url: '/api/issues/1',
        headers: { host: headers.host, origin: headers.origin, ...(key ? { 'x-ticketmap-target': key } : {}) }, payload });
      expect(response.statusCode).toBe(409);
    }
    expect(service.update).not.toHaveBeenCalled();
  });
  it('validates independent creation and applies the existing origin boundary', async () => {
    const { app, service } = setup();
    const body = { operationId: '11111111-1111-4111-8111-111111111111', title: 'New issue', description: '', labelIds: [] };
    const options = await app.inject({ method: 'GET', url: '/api/issues/creation-options', headers });
    expect(options.statusCode).toBe(200);
    expect(service.creationOptions).toHaveBeenCalledWith();
    for (const invalid of [{ ...body, title: ' ' }, { ...body, operationId: 'bad' }, { ...body, project: 'foreign' },
      { ...body, kind: 'subtask' }, { ...body, labelIds: ['duplicate', 'duplicate'] }]) {
      const response = await app.inject({ method: 'POST', url: '/api/issues', headers, payload: invalid });
      expect(response.statusCode).toBe(400);
    }
    const denied = await app.inject({ method: 'POST', url: '/api/issues', headers: { ...headers, origin: 'https://evil.example' }, payload: body });
    expect(denied.statusCode).toBe(403);
    expect(service.createIssue).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/issues', headers, payload: body });
    expect(response.statusCode).toBe(200);
    expect(service.createIssue).toHaveBeenCalledWith(body);
  });
  it('serves validated project images with safe headers and rejects proxy-style input', async () => {
    const { app, imageLoader } = setup();
    const path = `/api/images/${'a'.repeat(32)}/screen%20one.png`;
    const response = await app.inject({ method: 'GET', url: path, headers });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('image bytes');
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain('sandbox');
    expect(imageLoader).toHaveBeenCalledWith('a'.repeat(32), 'screen one.png');
    for (const invalid of ['/api/images/invalid/a.png', `${path}?url=https://evil.example`,
      `/api/images/${'a'.repeat(32)}/a%2Fb.png`, `/api/images/${'a'.repeat(32)}/a%5Cb.png`,
      `/api/images/${'a'.repeat(32)}/%2e%2e`, `/api/images/${'a'.repeat(32)}/a%252fb.png`])
      expect([400, 404]).toContain((await app.inject({ method: 'GET', url: invalid, headers })).statusCode);
    expect((await app.inject({ method: 'GET', url: path, headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect(imageLoader).toHaveBeenCalledTimes(1);
  });
  it('serves workspace and detail and disables response caching', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'GET', url: '/api/workspace', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().issues).toHaveLength(8);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/api/issues/1', headers })).statusCode).toBe(200);
  });
  it('rejects foreign, absent and null origins for mutations', async () => {
    const { app, service } = setup();
    for (const origin of ['https://evil.example', 'null', undefined]) {
      const response = await app.inject({ method: 'PATCH', url: '/api/issues/1',
        headers: { host: '127.0.0.1:4310', ...(origin ? { origin } : {}) }, payload });
      expect(response.statusCode).toBe(403);
    }
    expect(service.update).not.toHaveBeenCalled();
  });
  it('rejects DNS rebinding hosts', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/workspace', headers: { host: 'attacker.example:4310' } })).statusCode).toBe(403);
  });
  it('allows the actual LAN host and origin for reads and edits', async () => {
    const { app, service } = setup(['192.168.1.10']);
    const lanHeaders = { ...headers, host: '192.168.1.10:4310', origin: 'http://192.168.1.10:4310' };
    expect((await app.inject({ method: 'GET', url: '/api/workspace', headers: lanHeaders })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/api/issues/1', headers: lanHeaders, payload })).statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith('1', payload);
  });
  it('still rejects unknown hosts, foreign origins and wrong ports for LAN requests', async () => {
    const { app, service } = setup(['192.168.1.10']);
    expect((await app.inject({ method: 'GET', url: '/api/workspace', headers: { host: '192.168.1.99:4310' } })).statusCode).toBe(403);
    for (const origin of ['http://attacker.example:4310', 'http://192.168.1.99:4310',
      'http://192.168.1.10:5173', 'http://192.168.1.10', undefined]) {
      expect((await app.inject({ method: 'PATCH', url: '/api/issues/1',
        headers: { host: '192.168.1.10:4310', ...(origin ? { origin } : {}) }, payload })).statusCode).toBe(403);
    }
    expect(service.update).not.toHaveBeenCalled();
  });
  it('rejects invalid iid, empty titles and unexpected fields', async () => {
    const { app, service } = setup();
    for (const body of [{ ...payload, title: '   ' }, { ...payload, project: 'foreign' }, { title: 'missing version' }]) {
      expect((await app.inject({ method: 'PATCH', url: '/api/issues/1', headers, payload: body })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/issues/not-a-number', headers })).statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
  it('passes validated updates and returns conflicts with the current ticket', async () => {
    const { app, service } = setup();
    expect((await app.inject({ method: 'PATCH', url: '/api/issues/1', headers, payload })).statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith('1', payload);
    service.update.mockRejectedValueOnce(new ServiceError(409, 'Changed', issue(1)));
    const response = await app.inject({ method: 'PATCH', url: '/api/issues/1', headers, payload });
    expect(response.statusCode).toBe(409);
    expect(response.json().current.iid).toBe('1');
  });
  it('does not expose internal error details', async () => {
    const { app, service } = setup();
    service.workspace.mockRejectedValueOnce(new Error('private credential or stack trace'));
    const response = await app.inject({ method: 'GET', url: '/api/workspace', headers });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private');
  });
  it('validates and protects the connection endpoint', async () => {
    const { app, service } = setup(['192.168.1.10']);
    const connection = { targetIid: '2', kind: 'blocks', expectedSourceUpdatedAt: issue(1).updatedAt,
      expectedTargetUpdatedAt: issue(2).updatedAt };
    expect((await app.inject({ method: 'POST', url: '/api/issues/1/connections', headers, payload: connection })).statusCode).toBe(200);
    expect(service.connect).toHaveBeenCalledWith('1', connection);
    expect((await app.inject({ method: 'POST', url: '/api/issues/1/connections',
      headers: { ...headers, origin: 'https://attacker.example' }, payload: connection })).statusCode).toBe(403);
    for (const body of [{ ...connection, kind: 'parent' }, { ...connection, targetIid: 'other/project#2' },
      { ...connection, project: 'other' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/issues/1/connections', headers, payload: body })).statusCode).toBe(400);
    }
    expect(service.connect).toHaveBeenCalledTimes(1);
  });
  it('validates and protects connected creation and its source-only options', async () => {
    const { app, service } = setup();
    const payload = { operationId: '11111111-1111-4111-8111-111111111111', expectedSourceUpdatedAt: issue(1).updatedAt,
      title: 'Subtask', description: '', labelIds: [], kind: 'subtask' };
    expect((await app.inject({ method: 'GET', url: '/api/issues/1/creation-options', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/issues/1/children', headers, payload })).statusCode).toBe(200);
    expect(service.createConnected).toHaveBeenCalledWith('1', payload);
    for (const invalid of [{ ...payload, title: ' ' }, { ...payload, operationId: 'bad' },
      { ...payload, kind: 'duplicate' }, { ...payload, namespacePath: 'other/project' }])
      expect((await app.inject({ method: 'POST', url: '/api/issues/1/children', headers, payload: invalid })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/issues/1/children', headers: { ...headers, origin: 'https://foreign.example' }, payload })).statusCode).toBe(403);
    expect(service.createConnected).toHaveBeenCalledTimes(1);
  });
});
