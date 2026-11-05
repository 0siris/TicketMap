import { describe, expect, it } from 'vitest';
import { emptyFilters, filterIssues, readView, visibleGraph, writeView } from '../shared/view.js';
import { fixture, labels, statuses, TEST_TARGET } from './fixtures.js';

describe('filters and URL state', () => {
  it('keeps isolated and closed tickets by default', () => {
    expect(filterIssues(fixture(), emptyFilters())).toHaveLength(8);
  });
  it('uses OR within a category and AND between categories', () => {
    const filters = { ...emptyFilters(), labels: [labels[0].id, labels[1].id], statuses: [statuses[2].id, statuses[3].id] };
    expect(filterIssues(fixture(), filters).map(issue => issue.iid)).toEqual(['2', '3']);
  });
  it('does not infer native status from legacy labels', () => {
    expect(filterIssues(fixture(), { ...emptyFilters(), statuses: [statuses[2].id] }).map(issue => issue.iid)).toEqual(['2']);
  });
  it('searches descriptions and ticket numbers', () => {
    expect(filterIssues(fixture(), { ...emptyFilters(), query: 'Markdown-Text' }).map(issue => issue.iid)).toEqual(['1']);
    expect(filterIssues(fixture(), { ...emptyFilters(), query: '#8' }).map(issue => issue.iid)).toEqual(['8']);
  });
  it('filters assignment, milestone and relationship endpoints', () => {
    expect(filterIssues(fixture(), { ...emptyFilters(), assignees: ['person:1'] }).map(issue => issue.iid)).toEqual(['1']);
    expect(filterIssues(fixture(), { ...emptyFilters(), milestones: ['milestone:1'] }).map(issue => issue.iid)).toEqual(['2']);
    expect(filterIssues(fixture(), { ...emptyFilters(), relations: ['blocks'] }).map(issue => issue.iid)).toEqual(['2', '3']);
  });
  it('round trips all view settings and ignores unknown view or relation values', () => {
    const state = readView('?view=hierarchy&issue=2&q=%C3%BC&label=a&label=b&status=c&assignee=none&milestone=none&relation=blocks&context=1&collapsed=x&theme=a');
    expect(readView(writeView(state))).toEqual(state);
    expect(readView('?view=other&issue=bad&relation=bad').view).toBe('network');
    expect(readView('?relation=bad').filters.relations).toEqual([]);
  });
  it('adds exactly one hop of context without hiding isolated matches', () => {
    const workspace = fixture();
    const state = readView('?q=%232&context=1');
    const graph = visibleGraph(workspace, filterIssues(workspace, state.filters), state);
    expect(graph.nodes.map(issue => issue.iid)).toEqual(['1', '2', '3']);
    expect([...graph.matchIds]).toEqual([workspace.issues[1].id]);
  });
  it('collapses actual descendants without changing label membership', () => {
    const workspace = fixture();
    const state = { ...readView('?view=hierarchy'), collapsed: [workspace.issues[0].id] };
    const graph = visibleGraph(workspace, workspace.issues, state);
    expect(graph.nodes.map(issue => issue.iid)).not.toContain('2');
    expect(graph.nodes.map(issue => issue.iid)).toContain('4');
    const themes = visibleGraph(workspace, workspace.issues, { ...state, view: 'themes', theme: labels[0].id });
    expect(themes.nodes.map(issue => issue.iid)).toEqual(['1', '2']);
  });
  it('does not loop on malformed cyclic parent data', () => {
    const workspace = fixture();
    workspace.relations.push({ id: 'cycle', source: workspace.issues[1].id, target: workspace.issues[0].id, kind: 'parent' });
    const state = { ...readView('?view=hierarchy'), collapsed: [workspace.issues[0].id] };
    expect(() => visibleGraph(workspace, workspace.issues, state)).not.toThrow();
  });
  it('shows external references without making them editable filter matches', () => {
    const workspace = fixture();
    workspace.references.push({ id: 'external', iid: '90', title: 'Other project', webUrl: `${TEST_TARGET.gitlabUrl}/other/project/-/issues/90` });
    workspace.relations.push({ id: 'external-link', source: workspace.issues[0].id, target: 'external', kind: 'relates_to' });
    const graph = visibleGraph(workspace, workspace.issues, readView(''));
    expect(graph.references).toHaveLength(1);
    expect(graph.matches).toHaveLength(8);
  });
});
