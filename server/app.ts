import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ServiceError } from './glab.js';
import type { GitLabService } from './gitlab.js';
import type { ConnectionInput, CreateConnectedInput, CreateIssueInput, IssuePatch } from '../shared/types.js';
import { gitLabTargetKey, type GitLabTarget } from '../shared/types.js';
import type { ImageDownload } from './images.js';
import { validUpload } from '../shared/images.js';

export function createApp(service: Pick<GitLabService, 'workspace' | 'issue' | 'update' | 'connect' | 'creationOptions' | 'createConnected' | 'createIssue'>,
  { lanAddresses = [], imageLoader, target }:
  { lanAddresses?: string[]; imageLoader: (secret: string, filename: string) => Promise<ImageDownload>; target: GitLabTarget }) {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const hosts = new Set(['127.0.0.1', 'localhost', ...lanAddresses]);
  const origins = new Set([...hosts].map(host => `http://${host}:4310`)
    .concat(['http://127.0.0.1:5173', 'http://localhost:5173']));
  app.addHook('onRequest', async (request, reply) => {
    const hostname = request.headers.host?.split(':')[0];
    if (!hostname || !hosts.has(hostname))
      return reply.code(403).send({ message: 'Zugriff nur über eine lokale Adresse dieses Rechners erlaubt.' });
    if (request.headers.origin && !origins.has(request.headers.origin))
      return reply.code(403).send({ message: 'Diese Herkunft ist nicht erlaubt.' });
    if (!['GET', 'HEAD'].includes(request.method) && !origins.has(request.headers.origin ?? ''))
      return reply.code(403).send({ message: 'Für Änderungen ist eine erlaubte Browser-Herkunft erforderlich.' });
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-ticketmap-target'] !== gitLabTargetKey(target))
      return reply.code(409).send({ message: 'Das GitLab-Ziel wurde geändert. Seite neu laden, bevor Änderungen gespeichert werden.' });
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ServiceError)
      return reply.code(error.statusCode).send({ message: error.message, ...(error.current ? { current: error.current } : {}) });
    if (error instanceof Error && 'validation' in error)
      return reply.code(400).send({ message: 'Die Eingaben sind ungültig. Bitte prüfen.' });
    return reply.code(500).send({ message: 'Die Anfrage ist fehlgeschlagen. Bitte erneut versuchen.' });
  });
  app.get<{ Querystring: { refresh?: string } }>('/api/workspace', async request =>
    service.workspace(request.query.refresh === '1'));
  app.get<{ Params: { secret: string; filename: string } }>('/api/images/:secret/:filename', {
    schema: { params: { type: 'object', additionalProperties: false, required: ['secret', 'filename'], properties: {
      secret: { type: 'string', pattern: '^[a-fA-F0-9]{32}$' },
      filename: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[^/\\\\%\\x00-\\x1f\\x7f]+$' },
    } }, querystring: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => {
    if (!validUpload(request.params.secret, request.params.filename))
      throw new ServiceError(400, 'Ungültiger Bildanhang.');
    const image = await imageLoader(request.params.secret, request.params.filename);
    return reply.type(image.contentType).header('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(image.body);
  });
  const params = { type: 'object', required: ['iid'], additionalProperties: false,
    properties: { iid: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' } } };
  app.get('/api/issues/creation-options', async () => service.creationOptions());
  app.post<{ Body: CreateIssueInput }>('/api/issues', {
    schema: { body: { type: 'object', additionalProperties: false,
      required: ['operationId', 'title', 'description', 'labelIds'], properties: {
        operationId: { type: 'string', format: 'uuid' },
        title: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
        description: { type: 'string', maxLength: 1_048_576 },
        labelIds: { type: 'array', uniqueItems: true, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 180 } },
      } } },
  }, async request => service.createIssue(request.body));
  app.get<{ Params: { iid: string } }>('/api/issues/:iid/creation-options', { schema: { params } },
    async request => service.creationOptions(request.params.iid));
  app.post<{ Params: { iid: string }; Body: CreateConnectedInput }>('/api/issues/:iid/children', {
    schema: { params, body: { type: 'object', additionalProperties: false,
      required: ['operationId', 'expectedSourceUpdatedAt', 'title', 'description', 'labelIds', 'kind'], properties: {
        operationId: { type: 'string', format: 'uuid' }, expectedSourceUpdatedAt: { type: 'string', format: 'date-time' },
        title: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
        description: { type: 'string', maxLength: 1_048_576 },
        labelIds: { type: 'array', uniqueItems: true, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 180 } },
        kind: { type: 'string', enum: ['subtask', 'relates_to', 'blocks', 'is_blocked_by'] },
      } } },
  }, async request => service.createConnected(request.params.iid, request.body));
  app.post<{ Params: { iid: string }; Body: ConnectionInput }>('/api/issues/:iid/connections', {
    schema: { params, body: { type: 'object', additionalProperties: false,
      required: ['targetIid', 'kind', 'expectedSourceUpdatedAt', 'expectedTargetUpdatedAt'],
      properties: {
        targetIid: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
        kind: { type: 'string', enum: ['relates_to', 'blocks', 'is_blocked_by', 'duplicate'] },
        expectedSourceUpdatedAt: { type: 'string', format: 'date-time' },
        expectedTargetUpdatedAt: { type: 'string', format: 'date-time' },
        confirmDuplicate: { type: 'boolean' },
      } } },
  }, async request => service.connect(request.params.iid, request.body));
  app.get<{ Params: { iid: string } }>('/api/issues/:iid', { schema: { params } }, async request =>
    service.issue(request.params.iid));
  app.patch<{ Params: { iid: string }; Body: IssuePatch }>('/api/issues/:iid', {
    schema: {
      params,
      body: {
        type: 'object', additionalProperties: false, required: ['expectedUpdatedAt'],
        properties: {
          expectedUpdatedAt: { type: 'string', format: 'date-time' },
          title: { type: 'string', minLength: 1, maxLength: 1024, pattern: '\\S' },
          description: { type: 'string', maxLength: 1_048_576 },
          statusId: { type: 'string', minLength: 1, maxLength: 180 },
          addLabelIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 180 } },
          removeLabelIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 180 } },
        },
      },
    },
  }, async request => service.update(request.params.iid, request.body));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  if (existsSync(dist)) {
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/')
      ? reply.code(404).send({ message: 'Endpunkt nicht gefunden.' }) : reply.sendFile('index.html'));
  }
  return app;
}
