import { describe, expect, it, vi } from 'vitest';
import { GraphPositions, positionKey } from '../src/graph-positions.js';
import { readView } from '../shared/view.js';
import { PROJECT_PATH, TEST_TARGET } from './fixtures.js';

describe('graph positions', () => {
  it('separates projects and layouts, but shares coordinates across filters and collapsed groups', () => {
    const network = positionKey(PROJECT_PATH, readView(''), TEST_TARGET.gitlabUrl);
    expect(positionKey(PROJECT_PATH, readView('?q=test&theme=ignored&collapsed=1&overview=1'), TEST_TARGET.gitlabUrl)).toBe(network);
    const keys = ['', '?view=hierarchy', '?view=themes', '?view=themes&theme=one', '?view=themes&theme=two']
      .map(search => positionKey(PROJECT_PATH, readView(search), TEST_TARGET.gitlabUrl));
    expect(new Set(keys).size).toBe(5);
    expect(positionKey('another/project', readView(''), TEST_TARGET.gitlabUrl)).not.toBe(network);
    expect(positionKey(PROJECT_PATH, readView(''), 'https://another.example.com')).not.toBe(network);
  });

  it('migrates original public-instance layouts without sharing them with another host', () => {
    const legacy = `ticket-map:positions:v1:${JSON.stringify([PROJECT_PATH, 'network'])}`;
    const data = '[["card",{"x":125,"y":-70}]]';
    const storage = { getItem: vi.fn((key: string) => key === legacy ? data : null), setItem: vi.fn() };
    const report = vi.fn();
    const store = new GraphPositions(report, () => storage);
    const migrated = positionKey(PROJECT_PATH, readView(''), 'https://gitlab.com');
    const otherHost = positionKey(PROJECT_PATH, readView(''), TEST_TARGET.gitlabUrl);
    expect(store.read(otherHost).size).toBe(0);
    expect(store.read(migrated).get('card')).toEqual({ x: 125, y: -70 });
    store.save(migrated);
    expect(storage.setItem).toHaveBeenCalledWith(migrated, data);
    expect(report).not.toHaveBeenCalled();
  });

  it('uses an existing host-scoped layout instead of an older public-instance layout', () => {
    const key = positionKey(PROJECT_PATH, readView(''), 'https://gitlab.com');
    const data = '[["card",{"x":500,"y":600}]]';
    const storage = { getItem: vi.fn((value: string) => value === key ? data : null), setItem: vi.fn() };
    const store = new GraphPositions(vi.fn(), () => storage);
    expect(store.read(key).get('card')).toEqual({ x: 500, y: 600 });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it('round-trips only IDs and coordinates and retains hidden cards', () => {
    const storage = { getItem: vi.fn(() => '[["hidden",{"x":12,"y":-8}]]'), setItem: vi.fn() };
    const report = vi.fn();
    const store = new GraphPositions(report, () => storage);
    store.read('view').set('visible', { x: 44, y: 55 });
    store.save('view');
    expect(storage.setItem).toHaveBeenCalledWith('view', '[["hidden",{"x":12,"y":-8}],["visible",{"x":44,"y":55}]]');
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it.each(['{', '{}', '[["valid",{"x":1,"y":2}],["invalid",{"x":1e400,"y":2}]]',
    '[["id",{"x":"12","y":2}]]'])('recovers from malformed storage: %s', raw => {
    const report = vi.fn();
    const storage = { getItem: () => raw, setItem: vi.fn() };
    const store = new GraphPositions(report, () => storage);
    expect(store.read('view').size).toBe(0);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('nicht gelesen'));
    store.read('view').set('new', { x: 1, y: 2 });
    store.save('view');
    expect(storage.setItem).toHaveBeenCalledWith('view', '[["new",{"x":1,"y":2}]]');
  });

  it('keeps the in-memory map usable when storage access is denied', () => {
    const report = vi.fn();
    const store = new GraphPositions(report, () => { throw new Error('Access denied'); });
    store.read('view').set('id', { x: 1, y: 2 });
    store.save('view');
    expect(store.read('view').get('id')).toEqual({ x: 1, y: 2 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('nur bis zum Neuladen'));
  });

  it('reports quota failures without losing in-memory coordinates', () => {
    const report = vi.fn();
    const store = new GraphPositions(report, () => ({ getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); } }));
    store.read('view').set('id', { x: 3, y: 4 });
    store.save('view');
    expect(store.read('view').get('id')).toEqual({ x: 3, y: 4 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining('nicht gespeichert'));
  });
});
