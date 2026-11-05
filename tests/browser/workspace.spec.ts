import { test, expect, type Page } from '@playwright/test';
import { fixture, issue as fixtureIssue, labels, statuses, PROJECT_PATH, TEST_TARGET } from '../fixtures.js';
import { gitLabTargetKey, type ConnectionInput, type CreateConnectedInput, type GitLabTarget, type IssuePatch } from '../../shared/types.js';
import { positionKey } from '../../src/graph-positions.js';
import { readView } from '../../shared/view.js';

async function mockGitLab(page: Page, options: { conflict?: boolean; failure?: boolean; readonly?: boolean; target?: GitLabTarget } = {}) {
  const workspace = fixture();
  if (options.target) {
    Object.assign(workspace, options.target);
    for (const issue of workspace.issues)
      issue.webUrl = `${workspace.gitlabUrl}/${workspace.project}/-/work_items/${issue.iid}`;
  }
  if (options.readonly) for (const issue of workspace.issues) { issue.canEdit = false; issue.canSetMetadata = false; issue.canLink = false; issue.canDuplicate = false; }
  const updates: IssuePatch[] = [];
  const connections: ConnectionInput[] = [];
  const creations: CreateConnectedInput[] = [];
  let offline = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!['GET', 'HEAD'].includes(route.request().method()) &&
      route.request().headers()['x-ticketmap-target'] !== gitLabTargetKey(workspace))
      return route.fulfill({ status: 409, json: { message: 'Das GitLab-Ziel wurde geändert. Bitte die Seite neu laden.' } });
    if (offline) return route.abort();
    if (url.pathname === '/api/workspace') return route.fulfill({ json: workspace });
    if (url.pathname === '/api/issues/creation-options') return route.fulfill({ json: { canCreateSubtask: false, canCreateIssue: !options.readonly } });
    if (url.pathname === '/api/issues' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON(); creations.push(input);
      if (options.failure) return route.fulfill({ status: 502, json: { message: 'Erstellung wurde nicht bestätigt. Bitte GitLab prüfen.' } });
      const created = fixtureIssue(9, { title: input.title, description: input.description,
        webUrl: `${workspace.gitlabUrl}/${workspace.project}/-/work_items/9`,
        labels: workspace.labels.filter(label => input.labelIds.includes(label.id)) });
      workspace.issues.push(created);
      return route.fulfill({ json: { workspace, createdIid: created.iid } });
    }
    if (url.pathname.endsWith('/creation-options')) {
      const source = workspace.issues.find(issue => issue.iid === url.pathname.split('/')[3])!;
      return route.fulfill({ json: { source, canCreateSubtask: source.canAddChild, canCreateIssue: source.canLink } });
    }
    if (url.pathname.endsWith('/children')) {
      const input = route.request().postDataJSON() as CreateConnectedInput; creations.push(input);
      if (options.failure) return route.fulfill({ status: 502, json: { message: 'Erstellung wurde nicht bestätigt. Bitte GitLab prüfen.' } });
      const source = workspace.issues.find(issue => issue.iid === url.pathname.split('/')[3])!;
      const created = fixtureIssue(9, { title: input.title, description: input.description,
        webUrl: `${workspace.gitlabUrl}/${workspace.project}/-/work_items/9`,
        labels: workspace.labels.filter(label => input.labelIds.includes(label.id)),
        typeName: input.kind === 'subtask' ? 'Task' : 'Issue', canAddChild: input.kind !== 'subtask' });
      workspace.issues.push(created);
      workspace.relations.push({ id: `new:${created.id}`, kind: input.kind === 'subtask' ? 'parent' : input.kind === 'is_blocked_by' ? 'blocks' : input.kind,
        source: input.kind === 'is_blocked_by' ? created.id : source.id,
        target: input.kind === 'is_blocked_by' ? source.id : created.id });
      return route.fulfill({ json: { workspace, createdIid: created.iid } });
    }
    if (url.pathname.endsWith('/connections')) {
      const input = route.request().postDataJSON() as ConnectionInput;
      connections.push(input);
      if (options.failure) return route.fulfill({ status: 502, json: { message: 'GitLab ist nicht erreichbar.' } });
      const source = workspace.issues.find(issue => issue.iid === url.pathname.split('/')[3])!;
      const target = workspace.issues.find(issue => issue.iid === input.targetIid)!;
      workspace.relations.push({ id: `created:${source.id}:${target.id}`, kind: input.kind === 'is_blocked_by' ? 'blocks' : input.kind,
        source: input.kind === 'is_blocked_by' ? target.id : source.id, target: input.kind === 'is_blocked_by' ? source.id : target.id });
      if (input.kind === 'duplicate') { source.state = 'CLOSED'; source.status = statuses[6]; source.duplicateOf = target.webUrl; }
      return route.fulfill({ json: workspace });
    }
    const issue = workspace.issues.find(item => item.iid === url.pathname.split('/').pop());
    if (!issue) return route.fulfill({ status: 404, json: { message: 'Ticket nicht verfügbar.' } });
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as IssuePatch;
      updates.push(patch);
      if (options.failure) return route.fulfill({ status: 502, json: { message: 'GitLab ist nicht erreichbar.' } });
      if (options.conflict) {
        options.conflict = false;
        Object.assign(issue, { title: 'Zwischenzeitlich geändert', description: 'Neue Beschreibung in GitLab',
          status: statuses[3], labels: [labels[1], labels[2]], updatedAt: '2026-11-04T13:00:00Z' });
        return route.fulfill({ status: 409, json: { message: 'Das Ticket wurde inzwischen in GitLab geändert.', current: issue } });
      }
      if (patch.title !== undefined) issue.title = patch.title;
      if (patch.description !== undefined) issue.description = patch.description;
      if (patch.statusId) issue.status = statuses.find(status => status.id === patch.statusId)!;
      issue.labels = [...issue.labels.filter(label => !patch.removeLabelIds?.includes(label.id)),
        ...labels.filter(label => patch.addLabelIds?.includes(label.id))];
      issue.updatedAt = '2026-11-04T13:00:00Z';
    }
    return route.fulfill({ json: issue });
  });
  return { workspace, updates, connections, creations, offline: () => { offline = true; } };
}

const results = (page: Page) => page.getByRole('list', { name: 'Tickets', exact: true });
async function openFirst(page: Page) {
  await results(page).getByRole('button', { name: /#1 Open Treatment Viewer/ }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Treatment Viewer');
}
async function canvasPosition(page: Page, id: string) {
  await page.waitForFunction(id => {
    const container = document.querySelector('[data-testid=graph]') as any;
    return container?._cyreg?.cy?.getElementById(id).length > 0;
  }, id);
  return page.getByTestId('graph').evaluate((element, id) => {
    const cy = (element as any)._cyreg.cy;
    const position = cy.getElementById(id).renderedPosition();
    return { x: position.x, y: position.y };
  }, id);
}

async function modelPositions(page: Page) {
  await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  return page.getByTestId('graph').evaluate(element => Object.fromEntries(
    (element as any)._cyreg.cy.nodes().map((node: any) => [node.id(), { ...node.position() }])));
}

async function cardInViewport(page: Page, id: string) {
  return page.getByTestId('graph').evaluate((element, id) => {
    const cy = (element as any)._cyreg.cy;
    const node = cy.getElementById(id);
    if (!node.length) return false;
    const box = node.renderedBoundingBox();
    return box.x1 >= 20 && box.y1 >= 20 && box.x2 <= cy.width() - 20 && box.y2 <= cy.height() - 20;
  }, id);
}

async function dragFirstCard(page: Page) {
  const point = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const box = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.mouse.move(box.x + point.x + 110, box.y + point.y + 60, { steps: 12 });
  await page.mouse.up();
}

test('keeps dragged positions after GitLab refresh adds or removes cards and browser reload', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/');
  const before = await modelPositions(page);
  await dragFirstCard(page);
  const organized = await modelPositions(page);
  expect(organized['gid://gitlab/WorkItem/1']).not.toEqual(before['gid://gitlab/WorkItem/1']);
  mock.workspace.issues.push(fixtureIssue(9));
  mock.workspace.relations.push({ id: 'new:1:9', source: mock.workspace.issues[0].id,
    target: 'gid://gitlab/WorkItem/9', kind: 'relates_to' });
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(results(page).getByRole('button')).toHaveCount(9);
  const extended = await modelPositions(page);
  for (const [id, point] of Object.entries(organized)) expect(extended[id]).toEqual(point);
  const newPoint = extended['gid://gitlab/WorkItem/9'];
  for (const point of Object.values(organized) as { x: number; y: number }[])
    expect(Math.abs(point.x - newPoint.x) >= 330 || Math.abs(point.y - newPoint.y) >= 270).toBe(true);
  mock.workspace.issues = mock.workspace.issues.filter(issue => issue.iid !== '8');
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(results(page).getByRole('button')).toHaveCount(8);
  await page.reload();
  const restored = await modelPositions(page);
  for (const [id, point] of Object.entries(extended)) if (id !== 'gid://gitlab/WorkItem/8') expect(restored[id]).toEqual(point);
  expect(mock.updates).toHaveLength(0); expect(mock.connections).toHaveLength(0);
});

test('uses the configured server and subgroup project for ticket links and private attachments', async ({ page }) => {
  const target = { gitlabUrl: 'https://code.example.net:8443', project: 'engineering/platform/project' };
  const mock = await mockGitLab(page, { target, failure: true });
  const secret = 'c'.repeat(32);
  mock.workspace.issues[0].description = `![Anhang](${target.gitlabUrl}/${target.project}/uploads/${secret}/screen.png)`;
  await page.route('**/api/images/**', route => route.fulfill({ contentType: 'image/svg+xml', body: testImage }));
  await page.goto('/?issue=1');
  await expect(page.locator('.brand a')).toHaveAttribute('href', `${target.gitlabUrl}/${target.project}/-/issues`);
  await expect(page.getByRole('link', { name: 'In GitLab öffnen', exact: true }).first())
    .toHaveAttribute('href', `${target.gitlabUrl}/${target.project}/-/work_items/1`);
  await expect(page.getByRole('img', { name: 'Anhang', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Externes Bild laden', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Titel der neuen Karte' }).fill('Configured project');
  await dialog.getByRole('button', { name: 'Ticket in GitLab erstellen', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'Aktuellen Stand in GitLab prüfen', exact: true }))
    .toHaveAttribute('href', `${target.gitlabUrl}/${target.project}/-/work_items`);
  expect(mock.creations).toHaveLength(1);
});

test('retains the old draft and blocks its write after the server changes GitLab target', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/?issue=1');
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Draft for the original project');
  mock.workspace.project = 'another/group/project';
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('GitLab-Ziel wurde geändert');
  await expect(page.locator('.brand a')).toHaveAttribute('href', `${TEST_TARGET.gitlabUrl}/${PROJECT_PATH}/-/issues`);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Draft for the original project');
  await page.getByRole('button', { name: 'In GitLab speichern', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('GitLab-Ziel wurde geändert');
  expect(mock.updates).toHaveLength(0);
});

test('isolates saved positions when another GitLab host has the same project path', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/'); await dragFirstCard(page);
  const original = await modelPositions(page);
  mock.workspace.gitlabUrl = 'https://another.example.net';
  await page.reload();
  const otherHost = await modelPositions(page);
  expect(otherHost[fixtureIssue(1).id]).not.toEqual(original[fixtureIssue(1).id]);
  mock.workspace.gitlabUrl = TEST_TARGET.gitlabUrl;
  await page.reload();
  expect(await modelPositions(page)).toEqual(original);
});

test('restores an original public-instance arrangement into the host-scoped layout', async ({ page }) => {
  const target = { ...TEST_TARGET, gitlabUrl: 'https://gitlab.com' };
  const legacy = `ticket-map:positions:v1:${JSON.stringify([PROJECT_PATH, 'network'])}`;
  const saved = { x: 905, y: -540 };
  await page.addInitScript(({ key, point }) => {
    localStorage.setItem(key, JSON.stringify([['gid://gitlab/WorkItem/1', point]]));
  }, { key: legacy, point: saved });
  await mockGitLab(page, { target }); await page.goto('/');
  expect((await modelPositions(page))[fixtureIssue(1).id]).toEqual(saved);
  const key = positionKey(PROJECT_PATH, readView(''), target.gitlabUrl);
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
  expect(restored.find(([id]: [string]) => id === fixtureIssue(1).id)[1]).toEqual(saved);
});

test('retains hidden coordinates across filters and isolates network, hierarchy and label layouts', async ({ page }) => {
  await mockGitLab(page); await page.goto('/'); await dragFirstCard(page);
  const network = await modelPositions(page);
  await page.getByRole('searchbox', { name: 'Tickets durchsuchen' }).fill('Ohne Verbindungen');
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await page.reload();
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await expect(results(page).getByRole('button')).toHaveCount(8);
  expect(await modelPositions(page)).toEqual(network);
  await page.getByRole('button', { name: 'Hierarchie', exact: true }).click();
  await dragFirstCard(page);
  const hierarchy = await modelPositions(page);
  expect(hierarchy).not.toEqual(network);
  await page.getByRole('button', { name: 'Netz', exact: true }).click();
  expect(await modelPositions(page)).toEqual(network);
  await page.goto('/?view=themes&theme=label%3Aviewer'); await dragFirstCard(page);
  const theme = await modelPositions(page);
  await page.goto('/?view=themes&theme=label%3Abug');
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await page.goto('/?view=themes&theme=label%3Aviewer');
  expect(await modelPositions(page)).toEqual(theme);
  await page.goto('/?view=hierarchy');
  expect(await modelPositions(page)).toEqual(hierarchy);
  await page.goto('/?view=hierarchy&collapsed=gid%3A%2F%2Fgitlab%2FWorkItem%2F1');
  await expect(page.getByTestId('card-controls-2')).toHaveCount(0);
  await page.goto('/?view=hierarchy');
  expect(await modelPositions(page)).toEqual(hierarchy);
});

test('does not snap an ongoing drag back when background refresh adds a card', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/');
  const point = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const box = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(box.x + point.x, box.y + point.y); await page.mouse.down();
  await page.mouse.move(box.x + point.x + 100, box.y + point.y + 50, { steps: 12 });
  const dragging = await modelPositions(page);
  mock.workspace.issues.push(fixtureIssue(9));
  mock.workspace.relations.push({ id: 'new:1:9', source: mock.workspace.issues[0].id,
    target: 'gid://gitlab/WorkItem/9', kind: 'relates_to' });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(results(page).getByRole('button')).toHaveCount(9);
  const refreshed = await modelPositions(page);
  for (const [id, position] of Object.entries(dragging)) expect(refreshed[id]).toEqual(position);
  const newcomer = refreshed['gid://gitlab/WorkItem/9'];
  for (const point of Object.values(dragging) as { x: number; y: number }[])
    expect(Math.abs(point.x - newcomer.x) >= 330 || Math.abs(point.y - newcomer.y) >= 270).toBe(true);
  await page.mouse.up();
  await page.reload();
  expect(await modelPositions(page)).toEqual(refreshed);
});

test('persists explicit re-layout as the new arrangement', async ({ page }) => {
  await mockGitLab(page); await page.goto('/'); await dragFirstCard(page);
  const dragged = await modelPositions(page);
  await page.getByRole('button', { name: 'Graph neu anordnen', exact: true }).click();
  const arranged = await modelPositions(page);
  expect(arranged).not.toEqual(dragged);
  await page.reload();
  expect(await modelPositions(page)).toEqual(arranged);
});

test('recovers from malformed coordinates and reports unavailable browser storage', async ({ page }) => {
  const key = positionKey(PROJECT_PATH, readView(''), TEST_TARGET.gitlabUrl);
  await page.addInitScript(key => localStorage.setItem(key, 'invalid-json'), key);
  await mockGitLab(page); await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Kartenpositionen konnten nicht gelesen' })).toBeVisible();
  expect(Object.keys(await modelPositions(page))).toHaveLength(8);
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('Disabled'); } }));
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'nur bis zum Neuladen' })).toBeVisible();
  await dragFirstCard(page);
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(results(page).getByRole('button')).toHaveCount(8);
});

test('loads all statuses, filters, restores the URL and keeps isolated tickets', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/');
  await expect(results(page).getByRole('button')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Duplicate 1', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Tickets durchsuchen' }).fill('Ohne Verbindungen');
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await expect(page).toHaveURL(/q=Ohne/);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('Ohne Verbindungen');
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await page.getByRole('button', { name: 'Doing 1', exact: true }).click();
  await expect(results(page).getByRole('button')).toHaveCount(1);
  await expect(results(page)).toContainText('Modell drehen');
});

test('navigates label clusters and selects a ticket by clicking its graph node', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Themen', exact: true }).click();
  const clusterPosition = await canvasPosition(page, `theme:${labels[0].id}`);
  await page.getByTestId('graph').click({ position: clusterPosition });
  await expect(page.getByRole('button', { name: 'Alle Themen', exact: true })).toBeVisible();
  await expect(results(page).getByRole('button')).toHaveCount(2);
  const nodePosition = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  await page.getByTestId('graph').click({ position: nodePosition });
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Treatment Viewer');
  await expect(page).toHaveURL(/issue=1/);
});

test('collapses actual hierarchy children and retains isolated tickets', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/?view=hierarchy&issue=1');
  await expect(page.getByRole('button', { name: 'Untertickets einklappen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Untertickets einklappen', exact: true }).click();
  const ids = await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes().map((node: any) => node.id()));
  expect(ids).not.toContain('gid://gitlab/WorkItem/2');
  expect(ids).toContain('gid://gitlab/WorkItem/4');
  await page.getByRole('button', { name: 'Untertickets aufklappen', exact: true }).click();
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes().length)).toBe(8);
});

test('reveals an offscreen result at a readable scale and refocuses it with the keyboard without moving cards', async ({ page }) => {
  await mockGitLab(page); await page.goto('/');
  const id = fixtureIssue(2).id;
  await canvasPosition(page, id);
  const graph = page.getByTestId('graph');
  await graph.evaluate((element, id) => {
    const cy = (element as any)._cyreg.cy;
    const node = cy.getElementById(id);
    node.position({ x: 8000, y: 5000 }); node.emit('dragfree');
  }, id);
  const positions = await modelPositions(page);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(await cardInViewport(page, id)).toBe(false);
  const result = results(page).getByRole('button', { name: /#2 Doing/ });
  await result.click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Modell drehen');
  await expect.poll(() => cardInViewport(page, id)).toBe(true);
  const zoom = await graph.evaluate(element => (element as any)._cyreg.cy.zoom());
  expect(zoom).toBeGreaterThanOrEqual(0.8);
  expect(await modelPositions(page)).toEqual(positions);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(stored);

  const pan = { x: 7000, y: 7000 };
  await graph.evaluate((element, pan) => (element as any)._cyreg.cy.pan(pan), pan);
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled();
  expect(await graph.evaluate(element => (element as any)._cyreg.cy.pan())).toEqual(pan);
  expect(await cardInViewport(page, id)).toBe(false);
  await result.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => cardInViewport(page, id)).toBe(true);
  expect(await modelPositions(page)).toEqual(positions);
});

test('keeps the camera and draft when a result selection is canceled', async ({ page }) => {
  await mockGitLab(page); await page.goto('/'); await openFirst(page);
  await expect.poll(() => cardInViewport(page, fixtureIssue(1).id)).toBe(true);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Unsaved title');
  const graph = page.getByTestId('graph');
  const before = await graph.evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { pan: { ...cy.pan() }, zoom: cy.zoom() };
  });
  page.once('dialog', dialog => dialog.dismiss());
  await results(page).getByRole('button', { name: /#4 Open Ohne Verbindungen/ }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Unsaved title');
  const after = await graph.evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { pan: { ...cy.pan() }, zoom: cy.zoom() };
  });
  expect(after).toEqual(before);
  await expect(page).toHaveURL(/issue=1/);
});

test('reveals a collapsed hierarchy result at its saved position', async ({ page }) => {
  await mockGitLab(page); await page.goto('/?view=hierarchy&issue=1');
  const id = fixtureIssue(2).id;
  await canvasPosition(page, id);
  const graph = page.getByTestId('graph');
  await graph.evaluate((element, id) => {
    const cy = (element as any)._cyreg.cy;
    const node = cy.getElementById(id);
    node.position({ x: 8000, y: 5000 }); node.emit('dragfree');
  }, id);
  const positions = await modelPositions(page);
  await page.getByRole('button', { name: 'Untertickets einklappen', exact: true }).click();
  expect(await graph.evaluate((element, id) => (element as any)._cyreg.cy.getElementById(id).length, id)).toBe(0);
  await results(page).getByRole('button', { name: /#2 Doing/ }).click();
  await expect.poll(() => cardInViewport(page, id)).toBe(true);
  expect(await modelPositions(page)).toEqual(positions);
  await expect(page).not.toHaveURL(/collapsed=/);
});

test('opens the network map when a ticket result is selected in the theme overview', async ({ page }) => {
  await mockGitLab(page); await page.goto('/?view=themes');
  await canvasPosition(page, `theme:${labels[0].id}`);
  await results(page).getByRole('button', { name: /#4 Open Ohne Verbindungen/ }).click();
  await expect(page.getByRole('button', { name: 'Netz', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => cardInViewport(page, fixtureIssue(4).id)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Ohne Verbindungen');
});

test('saves a changed title and native status without replacing unrelated fields', async ({ page }) => {
  const mock = await mockGitLab(page);
  await page.goto('/'); await openFirst(page);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Viewer verbessert');
  await page.getByLabel('Status', { exact: true }).selectOption(statuses[2].id);
  await page.getByRole('button', { name: 'In GitLab speichern', exact: true }).click();
  await expect(page.getByText('In GitLab gespeichert.', { exact: true })).toBeVisible();
  expect(mock.updates).toEqual([{ expectedUpdatedAt: '2026-11-04T12:00:00Z', title: 'Viewer verbessert', statusId: statuses[2].id }]);
  await expect(results(page)).toContainText('Viewer verbessert');
  await expect(page.getByRole('button', { name: 'Doing 2', exact: true })).toBeVisible();
});

test('preserves unsaved text when ticket navigation is canceled and supports keyboard selection', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/');
  const first = results(page).getByRole('button', { name: /#1 Open Treatment Viewer/ });
  await first.focus(); await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Mein Entwurf');
  page.once('dialog', dialog => dialog.dismiss());
  await results(page).getByRole('button', { name: /#2 Doing/ }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Mein Entwurf');
  await expect(page).toHaveURL(/issue=1/);
  page.once('dialog', dialog => dialog.accept());
  await results(page).getByRole('button', { name: /#2 Doing/ }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Modell drehen');
});

test('keeps drafts on conflict and requires an explicit reconciliation', async ({ page }) => {
  const mock = await mockGitLab(page, { conflict: true });
  await page.goto('/'); await openFirst(page);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Mein Entwurf');
  await page.getByRole('button', { name: 'In GitLab speichern', exact: true }).click();
  await expect(page.getByText('Neuerer GitLab-Stand', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Mein Entwurf');
  await expect(page.getByRole('button', { name: 'In GitLab speichern', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Entwurf auf aktuellem Stand weiterbearbeiten' }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Mein Entwurf');
  await expect(page.getByRole('button', { name: 'In GitLab speichern', exact: true })).toBeEnabled();
  await expect(page.getByTestId('description-preview')).toContainText('Neue Beschreibung in GitLab');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue(statuses[3].id);
  await page.getByRole('button', { name: 'In GitLab speichern', exact: true }).click();
  await expect(page.getByText('In GitLab gespeichert.', { exact: true })).toBeVisible();
  expect(mock.updates[1]).toEqual({ expectedUpdatedAt: '2026-11-04T13:00:00Z', title: 'Mein Entwurf' });
});

test('keeps the draft and the last workspace when GitLab is unavailable', async ({ page }) => {
  const mock = await mockGitLab(page, { failure: true });
  await page.goto('/'); await openFirst(page);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Nicht verlieren');
  await page.getByRole('button', { name: 'In GitLab speichern', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('GitLab ist nicht erreichbar.');
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Nicht verlieren');
  mock.offline();
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.getByText(/zuletzt geladenen Daten bleiben sichtbar/)).toBeVisible();
  await expect(results(page).getByRole('button')).toHaveCount(8);
});

test('shows a safe Markdown preview and enforces readonly controls', async ({ page }) => {
  let externalImage = false;
  page.on('request', request => { if (request.url().includes('example.invalid')) externalImage = true; });
  await mockGitLab(page, { readonly: true });
  await page.goto('/'); await openFirst(page);
  await expect(page.getByTestId('description-preview').getByRole('heading', { name: 'Viewer', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).unsafe)).toBeUndefined();
  expect(externalImage).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Status', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Beschreibung', exact: true })).toBeDisabled();
});

const testImage = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#edf2e9"/><text x="70" y="150" font-size="60">Ticket attachment</text></svg>';

test('loads private images only when scrolled into the inspector and preserves them across edits', async ({ page }) => {
  const mock = await mockGitLab(page);
  const secret = 'a'.repeat(32);
  mock.workspace.issues[0].description = `[![Erster Anhang](/uploads/${secret}/first.png)](${TEST_TARGET.gitlabUrl}/${PROJECT_PATH}/-/issues/1)`
    + '\n\n' + 'Ein langer Absatz mit Ticketdetails.\n\n'.repeat(75) + `![Später Anhang](/uploads/${secret}/last.png)`;
  const requests: string[] = [];
  await page.route('**/api/images/**', route => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: 'image/svg+xml', body: testImage });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?issue=1');
  const first = page.getByRole('img', { name: 'Erster Anhang', exact: true });
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('loading', 'lazy');
  await expect(first).toHaveAttribute('decoding', 'async');
  await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('img', { name: 'Später Anhang', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Entwurf mit Bildern');
  expect(requests).toHaveLength(1);
  await page.getByText('Später Anhang – Bild wird beim Scrollen geladen', { exact: true }).scrollIntoViewIfNeeded();
  const last = page.getByRole('img', { name: 'Später Anhang', exact: true });
  await expect.poll(() => last.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  expect(requests).toHaveLength(2);
  expect(mock.updates).toHaveLength(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'output/playwright/lazy-images-desktop.png' });
});

test('loads external images only after consent and keeps useful failure recovery on a phone', async ({ page }) => {
  const mock = await mockGitLab(page);
  mock.workspace.issues[0].description = `![Extern](https://example.invalid/tracker.png)\n\n![Fehlt](/uploads/${'b'.repeat(32)}/missing.png)`;
  let externalRequests = 0;
  await page.route('https://example.invalid/tracker.png', route => {
    externalRequests++;
    expect(route.request().headers().referer).toBeUndefined();
    return route.fulfill({ contentType: 'image/svg+xml', body: testImage });
  });
  await page.route('**/api/images/**', route => route.fulfill({ status: 502, json: { message: 'Unavailable' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?issue=1');
  const consent = page.getByRole('button', { name: 'Externes Bild laden', exact: true });
  await expect(consent).toBeVisible();
  expect(externalRequests).toBe(0);
  await consent.click();
  const external = page.getByRole('img', { name: 'Extern', exact: true });
  await expect.poll(() => external.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Entwurf');
  await expect(consent).toHaveCount(0);
  expect(externalRequests).toBe(1);
  await page.locator('.ticket-image').last().scrollIntoViewIfNeeded();
  await expect(page.getByText('Bild konnte nicht geladen werden: Fehlt', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'In GitLab öffnen', exact: true }).last()).toBeVisible();
  const widths = await external.evaluate(img => ({ image: img.getBoundingClientRect().width,
    preview: img.closest('.markdown')!.getBoundingClientRect().width }));
  expect(widths.image).toBeLessThanOrEqual(widths.preview);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(mock.updates).toHaveLength(0);
  await page.screenshot({ path: 'output/playwright/lazy-images-mobile.png' });
});

test('provides filters, results and editor without horizontal overflow on a phone', async ({ page }) => {
  await mockGitLab(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await canvasPosition(page, fixtureIssue(1).id);
  await page.getByTestId('graph').evaluate(element => {
    const node = (element as any)._cyreg.cy.getElementById('gid://gitlab/WorkItem/1');
    node.position({ x: 8000, y: 5000 }); node.emit('dragfree');
  });
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('searchbox').fill('Treatment Viewer');
  await openFirst(page);
  await expect.poll(() => cardInViewport(page, fixtureIssue(1).id)).toBe(true);
  await expect(page.getByRole('button', { name: 'Ticket schließen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ticket schließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Themen', exact: true })).toBeVisible();
  expect(await cardInViewport(page, fixtureIssue(1).id)).toBe(true);
});

test('keeps titles on graph cards at all zoom levels and starts at a readable scale', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/');
  await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const initial = await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { zoom: cy.zoom(), label: cy.getElementById('gid://gitlab/WorkItem/1').style('label') };
  });
  expect(initial.zoom).toBeGreaterThanOrEqual(0.8);
  expect(initial.label).toContain('Treatment Viewer');
  await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
  const label = await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy; cy.zoom(0.2);
    return cy.getElementById('gid://gitlab/WorkItem/1').style('label');
  });
  expect(label).toContain('Treatment Viewer');
  await page.getByRole('button', { name: 'Lesbar', exact: true }).click();
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.zoom())).toBe(0.85);
  await page.screenshot({ path: 'output/playwright/readable-cards.png', fullPage: true });
});

async function choosePair(page: Page) {
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await results(page).getByRole('button', { name: /#1 Open Treatment Viewer/ }).click();
  await results(page).getByRole('button', { name: /#4 Open Ohne Verbindungen/ }).click();
  await expect(page.getByRole('dialog', { name: 'Tickets verbinden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verbindung in GitLab speichern', exact: true })).toBeEnabled();
}

test('creates a blocking connection after choosing two cards and a relationship', async ({ page }) => {
  const mock = await mockGitLab(page);
  await page.goto('/');
  await choosePair(page);
  await page.getByRole('radio', { name: /^Blockiert / }).check();
  await page.screenshot({ path: 'output/playwright/connection-dialog.png', fullPage: true });
  await page.getByRole('button', { name: 'Verbindung in GitLab speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.connections).toEqual([{ targetIid: '4', kind: 'blocks',
    expectedSourceUpdatedAt: '2026-11-04T12:00:00Z', expectedTargetUpdatedAt: '2026-11-04T12:00:00Z' }]);
  await expect(page.getByText('Verbindung zwischen #1 und #4 in GitLab gespeichert.', { exact: true })).toBeVisible();
});

test('requires explicit duplicate confirmation and identifies the original ticket', async ({ page }) => {
  const mock = await mockGitLab(page);
  await page.goto('/'); await choosePair(page);
  await page.getByRole('radio', { name: /^Duplikat von / }).check();
  const close = page.getByRole('button', { name: 'Als Duplikat schließen', exact: true });
  await expect(close).toBeDisabled();
  expect(mock.connections).toHaveLength(0);
  await page.getByRole('checkbox', { name: /Ich bestätige: Ticket #1 wird als Duplikat geschlossen/ }).check();
  await close.click();
  await expect(page.getByText('Ticket #1 wurde als Duplikat von #4 geschlossen.', { exact: true })).toBeVisible();
  expect(mock.connections[0]).toMatchObject({ targetIid: '4', kind: 'duplicate', confirmDuplicate: true });
  await expect(page.getByRole('button', { name: 'Duplicate 2', exact: true })).toBeVisible();
});

test('opens the relationship dialog when a connection is dragged between nodes', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/?overview=1');
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  const from = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const to = await canvasPosition(page, 'gid://gitlab/WorkItem/4');
  const box = await page.getByTestId('graph').boundingBox();
  await page.mouse.move(box!.x + from.x, box!.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box!.x + to.x, box!.y + to.y, { steps: 24 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Tickets verbinden' })).toBeVisible();
  await expect(page.getByLabel('Ausgangsticket', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('dialog')).toContainText('Ohne Verbindungen');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
});

test('supports touch selection and target search with large controls on a phone', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5174' });
  const page = await context.newPage();
  try {
    const mock = await mockGitLab(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Verbinden', exact: true }).tap();
    const node = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
    const box = await page.getByTestId('graph').boundingBox();
    await page.touchscreen.tap(box!.x + node.x, box!.y + node.y);
    await page.getByRole('button', { name: 'Ziel suchen', exact: true }).tap();
    await page.getByRole('searchbox', { name: 'Zielticket suchen' }).fill('Ohne Verbindungen');
    await page.getByRole('list', { name: 'Mögliche Zieltickets' }).getByRole('button').tap();
    const save = page.getByRole('button', { name: 'Verbindung in GitLab speichern', exact: true });
    await expect(save).toBeEnabled();
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'output/playwright/touch-connection.png', fullPage: true });
    await save.tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(mock.connections[0]).toMatchObject({ kind: 'relates_to', targetIid: '4' });
  } finally { await context.close(); }
});

test('retains connection selections on errors and never retries a write automatically', async ({ page }) => {
  const mock = await mockGitLab(page, { failure: true });
  await page.goto('/'); await choosePair(page);
  await page.getByRole('button', { name: 'Verbindung in GitLab speichern', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('GitLab ist nicht erreichbar.');
  await expect(page.getByLabel('Ausgangsticket', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Verbindung in GitLab speichern', exact: true })).toBeDisabled();
  expect(mock.connections).toHaveLength(1);
});

test('uses right-button dragging for camera pan without moving or selecting a card', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/');
  const position = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const box = (await page.getByTestId('graph').boundingBox())!;
  const before = await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { pan: cy.pan(), node: cy.getElementById('gid://gitlab/WorkItem/1').position() };
  });
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + position.x + 90, box.y + position.y + 45, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const after = await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { pan: cy.pan(), node: cy.getElementById('gid://gitlab/WorkItem/1').position() };
  });
  expect(after.pan.x - before.pan.x).toBeCloseTo(90);
  expect(after.pan.y - before.pan.y).toBeCloseTo(45);
  expect(after.node).toEqual(before.node);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  const current = await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  await page.mouse.move(box.x + current.x, box.y + current.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + current.x - 40, box.y + current.y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Ausgangsticket #1 gewählt.', { exact: true })).toHaveCount(0);
});

test('does not pan with a left-button background drag and recovers after a right drag outside the graph', async ({ page }) => {
  await mockGitLab(page);
  await page.goto('/'); await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const box = (await page.getByTestId('graph').boundingBox())!;
  const pan = () => page.getByTestId('graph').evaluate(element => ({ ...(element as any)._cyreg.cy.pan() }));
  const before = await pan();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 35, { steps: 10 }); await page.mouse.up();
  expect(await pan()).toEqual(before);
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(box.x + 10, 30, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const after = await pan();
  expect(after.y).not.toBe(before.y);
  await page.mouse.move(box.x + 100, box.y + 80);
  expect(await pan()).toEqual(after);
});

test('zooms promptly at the mouse pointer after panning without moving cards and respects zoom limits', async ({ page }) => {
  await mockGitLab(page); await page.goto('/');
  const graph = page.getByTestId('graph');
  const positions = await modelPositions(page);
  const box = (await graph.boundingBox())!;
  const pointer = { x: 30, y: 30 };
  await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + pointer.x + 50, box.y + pointer.y + 25, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.move(box.x + pointer.x, box.y + pointer.y);
  const before = await graph.evaluate((element, point) => {
    const cy = (element as any)._cyreg.cy;
    return { zoom: cy.zoom(), anchor: { x: (point.x - cy.pan().x) / cy.zoom(),
      y: (point.y - cy.pan().y) / cy.zoom() }, stored: JSON.stringify(localStorage) };
  }, pointer);
  const zoom = () => graph.evaluate(element => (element as any)._cyreg.cy.zoom());
  for (let step = 0; step < 8; step++) {
    await graph.evaluate(element => { (element as any)._cyreg.cy.zoom(0.85); });
    const previous = await zoom();
    await page.mouse.wheel(0, -120);
    await expect.poll(zoom).toBeGreaterThan(previous);
    const ratio = await zoom() / previous;
    expect(ratio).toBeGreaterThan(step < 4 ? 1.3 : 1.17);
    expect(ratio).toBeLessThan(step < 4 ? 1.34 : 1.2);
  }
  await graph.evaluate(element => { (element as any)._cyreg.cy.zoom(0.85); });
  const reversalStart = await zoom();
  for (let step = 0; step < 3; step++) {
    await page.mouse.wheel(0, -120);
    await expect.poll(zoom).toBeGreaterThan(reversalStart * 1.17);
    await page.mouse.wheel(0, 120);
    await expect.poll(zoom).toBeCloseTo(reversalStart, 8);
  }
  const after = await graph.evaluate((element, point) => {
    const cy = (element as any)._cyreg.cy;
    return { zoom: cy.zoom(), anchor: { x: (point.x - cy.pan().x) / cy.zoom(),
      y: (point.y - cy.pan().y) / cy.zoom() }, stored: JSON.stringify(localStorage) };
  }, pointer);
  expect(await modelPositions(page)).toEqual(positions);
  expect(after.stored).toBe(before.stored);
  const anchorBefore = after.anchor;
  await page.mouse.wheel(0, -120);
  await expect.poll(zoom).toBeGreaterThan(reversalStart * 1.17);
  const anchorAfter = await graph.evaluate((element, point) => {
    const cy = (element as any)._cyreg.cy;
    return { x: (point.x - cy.pan().x) / cy.zoom(), y: (point.y - cy.pan().y) / cy.zoom() };
  }, pointer);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 5);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 5);
  await graph.evaluate(element => (element as any)._cyreg.cy.zoom(2.49));
  await page.mouse.wheel(0, -100);
  await expect.poll(zoom).toBe(2.5);
  await graph.evaluate(element => (element as any)._cyreg.cy.zoom(0.0501));
  await page.mouse.wheel(0, 100);
  await expect.poll(zoom).toBe(0.05);
});

test('normalizes line-mode wheel steps without jumping to zoom limits', async ({ page }) => {
  await mockGitLab(page); await page.goto('/');
  const graph = page.getByTestId('graph');
  const positions = await modelPositions(page);
  const box = (await graph.boundingBox())!;
  const point = { x: 30, y: 30 };
  const zoom = () => graph.evaluate(element => (element as any)._cyreg.cy.zoom());
  for (let step = 0; step < 8; step++) {
    await graph.evaluate(element => { (element as any)._cyreg.cy.zoom(0.85); });
    const previous = await zoom();
    await graph.dispatchEvent('wheel', { deltaY: -3, deltaMode: 1,
      clientX: box.x + point.x, clientY: box.y + point.y });
    const ratio = await zoom() / previous;
    expect(ratio).toBeGreaterThan(step < 4 ? 1.3 : 1.17);
    expect(ratio).toBeLessThan(step < 4 ? 1.34 : 1.2);
  }
  const before = await graph.evaluate((element, p) => {
    const cy = (element as any)._cyreg.cy;
    return { zoom: cy.zoom(), x: (p.x - cy.pan().x) / cy.zoom(), y: (p.y - cy.pan().y) / cy.zoom() };
  }, point);
  await graph.dispatchEvent('wheel', { deltaY: 1, deltaMode: 1,
    clientX: box.x + point.x, clientY: box.y + point.y });
  expect(await zoom()).toBeGreaterThan(before.zoom / 1.2);
  expect(await zoom()).toBeLessThan(before.zoom / 1.17);
  await graph.dispatchEvent('wheel', { deltaY: -1, deltaMode: 1,
    clientX: box.x + point.x, clientY: box.y + point.y });
  const after = await graph.evaluate((element, p) => {
    const cy = (element as any)._cyreg.cy;
    return { zoom: cy.zoom(), x: (p.x - cy.pan().x) / cy.zoom(), y: (p.y - cy.pan().y) / cy.zoom() };
  }, point);
  expect(after.zoom).toBeCloseTo(before.zoom, 8);
  expect(after.x).toBeCloseTo(before.x, 5);
  expect(after.y).toBeCloseTo(before.y, 5);
  await graph.evaluate(element => { (element as any)._cyreg.cy.zoom(2.49); });
  await graph.dispatchEvent('wheel', { deltaY: -1, deltaMode: 1,
    clientX: box.x + point.x, clientY: box.y + point.y });
  expect(await zoom()).toBe(2.5);
  await graph.evaluate(element => { (element as any)._cyreg.cy.zoom(0.0501); });
  await graph.dispatchEvent('wheel', { deltaY: 1, deltaMode: 1,
    clientX: box.x + point.x, clientY: box.y + point.y });
  expect(await zoom()).toBe(0.05);
  expect(await modelPositions(page)).toEqual(positions);
});

test('keeps one-finger touch panning and pinch zoom on the graph', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5174' });
  const page = await context.newPage();
  try {
    await mockGitLab(page); await page.goto('/'); await canvasPosition(page, 'gid://gitlab/WorkItem/1');
    const box = (await page.getByTestId('graph').boundingBox())!;
    const before = await page.getByTestId('graph').evaluate(element => ({ ...(element as any)._cyreg.cy.pan() }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 12, y: box.y + 15 }] });
    for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x: box.x + 12 + step * 10, y: box.y + 15 + step * 5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => {
      const after = await page.getByTestId('graph').evaluate(element => ({ ...(element as any)._cyreg.cy.pan() }));
      return Math.hypot(after.x - before.x, after.y - before.y);
    }).toBeGreaterThan(30);
    const zoom = await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.zoom());
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { id: 1, x: center.x - 30, y: center.y }, { id: 2, x: center.x + 30, y: center.y },
    ] });
    for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { id: 1, x: center.x - 30 - step * 6, y: center.y }, { id: 2, x: center.x + 30 + step * 6, y: center.y },
    ] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.zoom()))
      .toBeGreaterThan(zoom * 1.3);
    await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('explains every arrow direction in a keyboard-accessible graph legend', async ({ page }) => {
  await mockGitLab(page); await page.goto('/');
  const summary = page.locator('.graph-legend summary');
  await summary.focus(); await page.keyboard.press('Enter');
  const legend = page.getByRole('region', { name: 'Pfeillegende' });
  await expect(legend).toBeVisible();
  for (const title of ['A ist verwandt mit B', 'A blockiert B', 'A ist Elternteil von B', 'A ist ein Duplikat von B'])
    await expect(legend.getByText(title, { exact: true })).toBeVisible();
  await expect(legend).toContainText('Die Pfeilspitze zeigt auf das blockierte Ticket.');
  await expect(legend).toContainText('B ist das Original.');
  await page.screenshot({ path: 'output/playwright/graph-legend.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(legend).not.toBeVisible();
  await expect(summary).toBeFocused();
});

test('keeps the legend reachable and scrollable on a touch phone', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5174' });
  const page = await context.newPage();
  try {
    await mockGitLab(page); await page.goto('/');
    const summary = page.locator('.graph-legend summary');
    await summary.tap();
    const legend = page.getByRole('region', { name: 'Pfeillegende' });
    await expect(legend).toBeVisible();
    const box = (await legend.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await legend.getByText('A ist ein Duplikat von B', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/graph-legend-touch.png', fullPage: true });
    await summary.tap(); await expect(legend).not.toBeVisible();
  } finally { await context.close(); }
});

async function emptyGraphPosition(page: Page) {
  return page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    for (let y = 40; y < cy.height() - 45; y += 70) for (let x = 40; x < cy.width() - 45; x += 80) {
      if (cy.nodes().every((node: any) => {
        const b = node.renderedBoundingBox();
        return x < b.x1 - 35 || x > b.x2 + 35 || y < b.y1 - 35 || y > b.y2 + 35;
      })) return { x, y };
    }
    throw new Error('No empty canvas position in fixture');
  });
}
async function dragPortToEmpty(page: Page) {
  const port = page.getByRole('button', { name: 'Verbindung von #1 ziehen', exact: true });
  await expect(port).toBeVisible();
  const portBox = (await port.boundingBox())!;
  const canvas = (await page.getByTestId('graph').boundingBox())!;
  const empty = await emptyGraphPosition(page);
  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + empty.x, canvas.y + empty.y, { steps: 18 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Verbundene Karte erstellen' })).toBeVisible();
  return empty;
}

test('starts a connection directly at a card port and asks how to link an existing card', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/');
  const port = page.getByRole('button', { name: 'Verbindung von #1 ziehen', exact: true });
  await expect(port).toBeVisible();
  const from = (await port.boundingBox())!;
  const to = await canvasPosition(page, 'gid://gitlab/WorkItem/2');
  const box = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 16 }); await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Tickets verbinden' })).toBeVisible();
  expect(mock.connections).toHaveLength(0); expect(mock.creations).toHaveLength(0);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
});

test('creates a subtask after dropping a port on empty space and keeps it at the drop point', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/');
  const drop = await dragPortToEmpty(page);
  await expect(page.getByRole('combobox', { name: 'Beziehung der neuen Karte', exact: true })).toHaveValue('subtask');
  await page.getByRole('textbox', { name: 'Titel der neuen Karte', exact: true }).fill('Viewer Navigation prüfen');
  await page.getByRole('textbox', { name: 'Beschreibung der neuen Karte', exact: true }).fill('Neue Unteraufgabe');
  await page.getByRole('dialog').getByRole('checkbox', { name: 'AI', exact: true }).check();
  await page.screenshot({ path: 'output/playwright/create-subtask.png', fullPage: true });
  await page.getByRole('button', { name: 'Unteraufgabe in GitLab erstellen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mock.creations[0]).toMatchObject({ kind: 'subtask', title: 'Viewer Navigation prüfen', labelIds: [labels[1].id] });
  expect(mock.creations[0].operationId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(results(page)).toContainText('Viewer Navigation prüfen');
  const position = await canvasPosition(page, 'gid://gitlab/WorkItem/9');
  expect(position.x).toBeCloseTo(drop.x, 0); expect(position.y).toBeCloseTo(drop.y, 0);
  await expect(page.getByTestId('card-controls-9')).toContainText('AI');
  const placed = await modelPositions(page);
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await page.reload();
  expect(await modelPositions(page)).toEqual(placed);
});

test('cancels empty-space creation without creating a ticket and does not retry uncertain writes', async ({ page }) => {
  const mock = await mockGitLab(page, { failure: true }); await page.goto('/');
  await dragPortToEmpty(page);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(mock.creations).toHaveLength(0);
  await dragPortToEmpty(page);
  await page.getByRole('textbox', { name: 'Titel der neuen Karte', exact: true }).fill('Nicht doppelt anlegen');
  await page.getByRole('button', { name: 'Unteraufgabe in GitLab erstellen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Erstellung wurde nicht bestätigt');
  await expect(page.getByRole('button', { name: 'Unteraufgabe in GitLab erstellen', exact: true })).toBeDisabled();
  expect(mock.creations).toHaveLength(1);
  await expect(page.getByRole('textbox', { name: 'Titel der neuen Karte', exact: true })).toHaveValue('Nicht doppelt anlegen');
});

test('reveals and arranges previously filtered cards after creating a connected card', async ({ page }) => {
  await mockGitLab(page); await page.goto('/?label=label%3Aviewer');
  await expect(results(page).getByRole('button')).toHaveCount(2);
  await dragPortToEmpty(page);
  await page.getByRole('textbox', { name: 'Titel der neuen Karte', exact: true }).fill('Unteraufgabe ohne Filterlabel');
  await page.getByRole('button', { name: 'Unteraufgabe in GitLab erstellen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(results(page).getByRole('button')).toHaveCount(9);
  const positions = await page.getByTestId('graph').evaluate(element =>
    (element as any)._cyreg.cy.nodes('.ticket').map((node: any) => JSON.stringify(node.position())));
  expect(new Set(positions).size).toBe(9);
});

test('edits card labels through a quick action and updates its colored markers', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/');
  await page.getByRole('button', { name: 'Labels für #1 bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Labels für #1', exact: true });
  await expect(dialog.getByRole('checkbox', { name: 'Treatment Viewer', exact: true })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'AI', exact: true }).check();
  await page.screenshot({ path: 'output/playwright/card-label-actions.png', fullPage: true });
  await page.getByRole('button', { name: 'Labels speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.updates[0]).toEqual({ expectedUpdatedAt: '2026-11-04T12:00:00Z', addLabelIds: [labels[1].id] });
  await expect(page.getByTestId('card-controls-1').getByText('AI', { exact: true })).toBeVisible();
});

test('keeps quick label choices on a conflict and disables writes until a fresh version is loaded', async ({ page }) => {
  const mock = await mockGitLab(page, { conflict: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Labels für #1 bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Labels für #1', exact: true });
  await dialog.getByRole('checkbox', { name: 'AI', exact: true }).check();
  await page.getByRole('button', { name: 'Labels speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Das Ticket wurde inzwischen');
  await expect(dialog.getByRole('checkbox', { name: 'AI', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Labels speichern', exact: true })).toBeDisabled();
  expect(mock.updates).toHaveLength(1);
});

test('offers touch-sized card ports and keyboard/tap creation without precise dragging', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5174' });
  const page = await context.newPage();
  try {
    const mock = await mockGitLab(page); await page.goto('/');
    const port = page.getByRole('button', { name: 'Verbindung von #1 ziehen', exact: true });
    await expect(port).toBeVisible(); expect(Math.round((await port.boundingBox())!.width)).toBeGreaterThanOrEqual(44);
    await port.tap();
    await page.getByRole('button', { name: 'Neue Karte', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Verbundene Karte erstellen' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Beziehung der neuen Karte' })).toHaveValue('subtask');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'output/playwright/card-port-touch.png', fullPage: true });
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).tap(); expect(mock.creations).toHaveLength(0);
  } finally { await context.close(); }
});

test('highlights direct neighbors and edges, dims unrelated cards and clears the selection', async ({ page }) => {
  const mock = await mockGitLab(page);
  mock.workspace.relations.push({ id: 'blocks:3:5', source: mock.workspace.issues[2].id,
    target: mock.workspace.issues[4].id, kind: 'blocks' });
  await page.goto('/');
  await canvasPosition(page, 'gid://gitlab/WorkItem/1');
  const edgeStyles = () => page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.edges().map((edge: any) => ({
    id: edge.id(), source: edge.source().id(), target: edge.target().id(), color: edge.style('line-color'),
    arrowColor: edge.style('target-arrow-color'), arrow: edge.style('target-arrow-shape'), line: edge.style('line-style') })));
  const originalStyles = await edgeStyles();
  const before = await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes().map((node: any) => node.position()));
  await openFirst(page);
  const focused = await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { selected: cy.nodes('.selected').map((n: any) => n.data('iid')),
      neighbors: cy.nodes('.selection-neighbor').map((n: any) => n.data('iid')).sort(),
      muted: cy.nodes('.selection-muted').map((n: any) => n.data('iid')).sort(),
      edges: cy.edges('.highlighted').map((edge: any) => edge.id()).sort(),
      otherEdges: cy.edges('.selection-muted').map((edge: any) => edge.id()),
      positions: cy.nodes().map((node: any) => node.position()) };
  });
  expect(focused.selected).toEqual(['1']); expect(focused.neighbors).toEqual(['2', '3']);
  expect(focused.muted).toEqual(['4', '5', '6', '7', '8']);
  expect(focused.edges).toEqual(['parent:1:2', 'relates:1:3']);
  expect(focused.otherEdges).toEqual(['blocks:3:2', 'blocks:3:5']);
  expect(focused.positions).toEqual(before);
  expect(await edgeStyles()).toEqual(originalStyles);
  expect(await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy;
    return { selected: cy.nodes('.selected').style('opacity'), neighbor: cy.nodes('.selection-neighbor').style('opacity'),
      muted: cy.nodes('.selection-muted').style('opacity'), highlighted: cy.edges('.highlighted').style('opacity'),
      mutedEdge: cy.edges('.selection-muted').style('opacity') };
  })).toEqual({ selected: '1', neighbor: '1', muted: '0.22', highlighted: '1', mutedEdge: '0.12' });
  await expect(page.getByTestId('card-controls-2')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('card-controls-4')).toHaveCSS('opacity', '0.22');
  await page.getByRole('button', { name: 'Alles einpassen', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/selection-neighbors.png', fullPage: true });
  await results(page).getByRole('button', { name: /#4 Open Ohne Verbindungen/ }).click();
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Ohne Verbindungen');
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-neighbor').length)).toBe(0);
  await page.getByRole('button', { name: 'Ticket schließen', exact: true }).click();
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.elements('.selection-muted, .selection-neighbor, .selected, .highlighted').length)).toBe(0);
  await expect(page.getByTestId('card-controls-4')).toHaveCSS('opacity', '1');
});

test('respects relationship filters and restores contrast when the selected card is absent', async ({ page }) => {
  await mockGitLab(page); await page.goto('/?issue=1&relation=parent');
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toBeVisible();
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-neighbor').map((n: any) => n.data('iid')))).toEqual(['2']);
  await page.getByRole('searchbox', { name: 'Tickets durchsuchen' }).fill('Modell drehen');
  await expect(results(page).getByRole('button')).toHaveCount(1);
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-muted').length)).toBe(0);
  await expect(page.getByTestId('card-controls-2')).toHaveCSS('opacity', '1');
});

test('clears neighbor emphasis when empty canvas is clicked', async ({ page }) => {
  await mockGitLab(page); await page.goto('/'); await openFirst(page);
  const position = await emptyGraphPosition(page);
  await page.getByTestId('graph').click({ position });
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveCount(0);
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.elements('.selection-muted').length)).toBe(0);
});

test('keeps selection emphasis and the draft when canvas deselection is canceled', async ({ page }) => {
  const mock = await mockGitLab(page); await page.goto('/'); await openFirst(page);
  await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Mein Entwurf');
  const position = await emptyGraphPosition(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByTestId('graph').click({ position });
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Mein Entwurf');
  await expect(page).toHaveURL(/issue=1/);
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selected').data('iid'))).toBe('1');
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('graph').click({ position });
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveCount(0);
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.elements('.selection-muted, .selected').length)).toBe(0);
  expect(mock.updates).toHaveLength(0);
});

test('emphasizes visible context neighbors and restores context contrast after deselection', async ({ page }) => {
  await mockGitLab(page); await page.goto('/?issue=1&q=Treatment&context=1');
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toBeVisible();
  await expect(page.getByTestId('card-controls-3')).toHaveCSS('opacity', '1');
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-neighbor').map((node: any) => node.data('iid')).sort())).toEqual(['2', '3']);
  await page.getByRole('button', { name: 'Ticket schließen', exact: true }).click();
  await expect(page.getByTestId('card-controls-3')).toHaveCSS('opacity', '0.45');
  await page.getByRole('button', { name: 'Hierarchie', exact: true }).click();
  await openFirst(page);
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-neighbor').map((node: any) => node.data('iid')))).toEqual(['2']);
  await page.getByRole('button', { name: 'Untertickets einklappen', exact: true }).click();
  expect(await page.getByTestId('graph').evaluate(element => (element as any)._cyreg.cy.nodes('.selection-neighbor').length)).toBe(0);
});


test('creates an independent ticket from the header, selects it and keeps existing positions after reload', async ({ page }) => {
  const api = await mockGitLab(page); await page.goto('/');
  await canvasPosition(page, fixtureIssue(1).id);
  const before = await page.getByTestId('graph').evaluate(el => (el as any)._cyreg.cy.nodes().map((n: any) => ({ id: n.id(), position: n.position() })));
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Neues Ticket erstellen' });
  await expect(dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' })).toBeDisabled();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Titel der neuen Karte' }).fill('Eigenständiges Ticket');
  await dialog.getByRole('textbox', { name: 'Beschreibung der neuen Karte' }).fill('Neue Planung');
  await dialog.getByRole('checkbox', { name: labels[0].name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Eigenständiges Ticket');
  expect(api.creations).toHaveLength(1);
  expect(api.creations[0]).not.toHaveProperty('kind');
  expect(api.creations[0]).not.toHaveProperty('expectedSourceUpdatedAt');
  expect(api.workspace.relations).toHaveLength(fixture().relations.length);
  const positions = await page.getByTestId('graph').evaluate(el => (el as any)._cyreg.cy.nodes().map((n: any) => ({ id: n.id(), position: n.position() })));
  for (const node of before) expect(positions.find((n: any) => n.id === node.id)).toEqual(node);
  await page.reload(); await canvasPosition(page, fixtureIssue(9).id);
  const restored = await page.getByTestId('graph').evaluate(el => (el as any)._cyreg.cy.nodes().map((n: any) => ({ id: n.id(), position: n.position() })));
  expect(restored).toEqual(positions);
});

test('independent creation cancels without writes and locks uncertain submissions', async ({ page }) => {
  const api = await mockGitLab(page, { failure: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Titel der neuen Karte' }).fill('Entwurf');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  expect(api.creations).toHaveLength(0);
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Titel der neuen Karte' }).fill('Erstellung prüfen');
  await dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Erstellung wurde nicht bestätigt');
  await expect(dialog.getByRole('textbox', { name: 'Titel der neuen Karte' })).toHaveValue('Erstellung prüfen');
  await expect(dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' })).toBeDisabled();
  expect(api.creations).toHaveLength(1);
});

test('new ticket on a phone shows permission denial without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockGitLab(page, { readonly: true }); await page.goto('/');
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Du darfst hier kein Ticket erstellen');
  await expect(dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(api.creations).toHaveLength(0);
});


test('keeps creation locked until an older refresh finishes and then applies the new ticket', async ({ page }) => {
  const api = await mockGitLab(page); await page.goto('/');
  await canvasPosition(page, fixtureIssue(1).id);
  const olderWorkspace = structuredClone(api.workspace);
  let release: (() => void) | undefined;
  await page.route('**/api/workspace?refresh=1', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: olderWorkspace });
  });
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Neues Ticket', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Neues Ticket erstellen' });
  await dialog.getByRole('textbox', { name: 'Titel der neuen Karte' }).fill('After refresh');
  await dialog.getByRole('button', { name: 'Ticket in GitLab erstellen' }).click();
  await expect.poll(() => api.creations.length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Erstellung schlie/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Erstellt/ })).toBeDisabled();
  release!();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('After refresh');
  await expect(page.getByText('Ticket #9 wurde in GitLab erstellt.', { exact: true })).toBeVisible();
});

test('shows card assignees, unassigned state and long multiple names without moving cards on refresh', async ({ page }) => {
  const api = await mockGitLab(page);
  const longName = 'Alexandra-ExtremelyLongUnbreakableFamilyNameForLayoutVerification';
  api.workspace.issues[1].title = 'A long ticket title that still stays readable above the compact assignment and label strip';
  api.workspace.issues[1].typeName = 'Task';
  api.workspace.issues[1].labels = [...labels];
  api.workspace.issues[2].assignees = [{ id: 'person:long', name: longName, username: 'long' }];
  await page.goto('/');
  const before = await modelPositions(page);
  const first = page.getByTestId('card-controls-1');
  const second = page.getByTestId('card-controls-2');
  await expect(first.getByRole('img', { name: 'Zugewiesen: Alex Example', exact: true })).toBeAttached();
  await expect(second.getByRole('img', { name: 'Nicht zugewiesen', exact: true })).toBeAttached();
  const long = page.getByTestId('card-controls-3').getByRole('img', { name: `Zugewiesen: ${longName}`, exact: true });
  await expect(long).toHaveAttribute('title', `Zugewiesen: ${longName}`);
  expect(await long.locator('span').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

  const names = ['王 小明', longName, 'Sam Example'];
  api.workspace.issues[1].assignees = names.map((name, index) => ({ id: `person:new:${index}`, name, username: `new${index}` }));
  api.workspace.issues[0].assignees = [];
  await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  const assignment = second.getByRole('img', { name: `Zugewiesen: ${names.join(', ')}`, exact: true });
  await expect(assignment).toBeAttached();
  await expect(assignment.locator('span')).toHaveText(names[0]);
  await expect(assignment.locator('strong')).toHaveText('+2');
  await expect(first.getByRole('img', { name: 'Nicht zugewiesen', exact: true })).toBeAttached();
  const after = await modelPositions(page);
  expect(after).toEqual(before);
  const footerLayout = await second.locator('.node-card-footer').evaluate(element => {
    const footer = element.getBoundingClientRect();
    const children = [...element.children].map(child => child.getBoundingClientRect());
    return { inside: children.every(child => child.left >= footer.left && child.right <= footer.right + 1),
      separate: children[0].right <= children[1].left };
  });
  expect(footerLayout).toEqual({ inside: true, separate: true });
  await expect(second.locator('.node-label-overflow')).toHaveText('+1');
  await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy; cy.center(cy.getElementById('gid://gitlab/WorkItem/2'));
  });
  const open = second.getByRole('button', { name: 'Ticket #2 öffnen', exact: true });
  await expect(open).toHaveAttribute('title', `Ticket öffnen · Zugewiesen: ${names.join(', ')}`);
  await expect(open).toHaveCSS('pointer-events', 'auto');
  await page.screenshot({ path: 'output/playwright/card-assignees-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('graph').evaluate(element => {
    const cy = (element as any)._cyreg.cy; cy.center(cy.getElementById('gid://gitlab/WorkItem/2'));
  });
  await page.screenshot({ path: 'output/playwright/card-assignees-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(api.updates).toHaveLength(0);
});
