import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { DropPosition, Issue, ViewState, Workspace } from '../shared/types.js';
import { visibleGraph } from '../shared/view.js';
import { safeGitLabUrl } from './api.js';
import { installMousePanning, installWheelNormalization } from './graph-mouse.js';
import { NodeControls } from './NodeControls.js';
import { GraphPositions, positionKey } from './graph-positions.js';

export interface GraphHandle { fit(): void; readable(): void; focus(id: string): void; zoom(factor: number): void;
  layout(): void; createChild(iid: string): void }
interface Props {
  workspace: Workspace; matched: Issue[]; state: ViewState;
  select: (iid: string) => void; theme: (id: string) => void;
  connecting: boolean; connectionSource: string;
  connect: (source: string, target: string) => void;
  create: (source: string, point: DropPosition) => void; labels: (iid: string) => void; start: (iid: string) => void;
  placement: { iid: string; point: DropPosition } | null;
}

export const Graph = forwardRef<GraphHandle, Props>(function Graph(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [overlayCore, setOverlayCore] = useState<Core | null>(null);
  const core = useRef<Core | null>(null);
  const [storageNotice, setStorageNotice] = useState('');
  const positions = useRef<GraphPositions | null>(null);
  if (!positions.current) positions.current = new GraphPositions(setStorageNotice);
  const activeView = useRef('');
  const appliedPlacement = useRef<Props['placement']>(null);
  const latest = useRef(props);
  latest.current = props;
  function readable() {
    const cy = core.current;
    if (!cy) return;
    const { workspace, state, connectionSource } = latest.current;
    if (state.view === 'themes' && !state.theme) { cy.fit(undefined, 45); return; }
    const selected = workspace.issues.find(issue => issue.iid === (connectionSource || state.selected));
    let anchor = selected ? cy.getElementById(selected.id) : cy.nodes('.ticket').sort((a, b) => b.degree() - a.degree()).first();
    if (!anchor.length) anchor = cy.nodes().first();
    cy.zoom(0.85);
    if (anchor.length) {
      cy.center(cy.width() >= 700 ? anchor.closedNeighborhood() : anchor);
      // Keep the anchor card and its quick actions inside the readable viewport.
      const box = anchor.renderedBoundingBox();
      cy.panBy({
        x: box.x1 < 40 ? 40 - box.x1 : box.x2 > cy.width() - 40 ? cy.width() - 40 - box.x2 : 0,
        y: box.y1 < 40 ? 40 - box.y1 : box.y2 > cy.height() - 40 ? cy.height() - 40 - box.y2 : 0,
      });
    }
  }
  function remember() {
    const cy = core.current;
    if (!cy || !activeView.current) return;
    const saved = positions.current!.read(activeView.current);
    cy.nodes('.ticket, .external, .theme').forEach(node => { saved.set(node.id(), { ...node.position() }); });
    positions.current!.save(activeView.current);
  }
  function arrange() {
    const cy = core.current;
    if (!cy || !cy.nodes().length) return;
    const { state } = latest.current;
    if (state.view === 'themes' && !state.theme) {
      cy.layout({ name: 'grid', fit: true, padding: 60, avoidOverlap: true }).run();
      return;
    }
    // Lay out each component, then pack the forest. A single breadth-first layout puts
    // every isolated ticket in one very long root row and makes the graph unreadable.
    const components = cy.elements().components();
    for (const component of components) {
      if (component.nodes().length === 1) component.nodes().positions(() => ({ x: 0, y: 0 }));
      else component.layout(state.view === 'hierarchy'
        ? { name: 'breadthfirst', directed: true, fit: false, spacingFactor: 1.2, animate: false }
        : { name: 'cose', animate: false, fit: false, randomize: false,
          nodeRepulsion: () => 35_000, idealEdgeLength: () => 100, nodeOverlap: 25, numIter: 600 }).run();
    }
    const boxes = components.map(component => ({ component, box: component.boundingBox() }))
      .sort((a, b) => b.box.h - a.box.h);
    const area = boxes.reduce((sum, { box }) => sum + (box.w + 45) * (box.h + 45), 0);
    const rowWidth = Math.max(...boxes.map(({ box }) => box.w), Math.sqrt(area * cy.width() / Math.max(cy.height(), 1)));
    let x = 0; let y = 0; let rowHeight = 0;
    cy.batch(() => {
      for (const { component, box } of boxes) {
        if (x && x + box.w > rowWidth) { x = 0; y += rowHeight + 45; rowHeight = 0; }
        component.nodes().shift({ x: x - box.x1, y: y - box.y1 });
        x += box.w + 45; rowHeight = Math.max(rowHeight, box.h);
      }
    });
    cy.fit(undefined, 45);
    if (!state.overview) readable();
  }
  function layout() { arrange(); remember(); }
  useImperativeHandle(ref, () => ({
    fit: () => { core.current?.fit(undefined, 45); },
    readable,
    createChild: iid => {
      const cy = core.current; const issue = latest.current.workspace.issues.find(issue => issue.iid === iid);
      const node = issue && cy?.getElementById(issue.id);
      if (node?.length) latest.current.create(iid, { x: node.position('x') + node.width() + 80, y: node.position('y') + 80 });
    },
    focus: id => {
      const cy = core.current;
      if (!cy) return;
      const node = cy.getElementById(id);
      if (node.length) { cy.fit(node.closedNeighborhood(), 90); cy.zoom(Math.min(cy.zoom(), 1.3)); cy.center(node); }
    },
    zoom: factor => {
      const cy = core.current;
      if (cy) cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    }, layout,
  }));
  useEffect(() => {
    const removeWheelNormalization = installWheelNormalization(container.current!);
    const cy = cytoscape({ container: container.current!, elements: [], minZoom: 0.05, maxZoom: 2.5,
      wheelSensitivity: 6, selectionType: 'single', boxSelectionEnabled: false, touchTapThreshold: 12,
      style: [
        { selector: 'node', style: {
          'shape': 'round-rectangle', 'width': 284, 'height': 224, 'background-color': '#ffffff',
          'border-width': 2, 'border-color': 'data(color)', 'label': 'data(label)',
          'font-family': 'IBM Plex Sans, sans-serif', 'font-size': 14, 'font-weight': 500, 'color': '#25332e',
          'text-wrap': 'wrap', 'text-max-width': '254px', 'text-valign': 'center', 'text-halign': 'center',
          'line-height': 1.45, 'overlay-opacity': 0,
        } },
        { selector: 'node.theme', style: { width: 210, height: 100, 'background-color': '#f0f4ed',
          'border-color': '#c7d3c4', 'font-size': 15 } },
        { selector: 'node.external', style: { 'border-style': 'dashed', 'background-color': '#f1f2f4' } },
        { selector: 'node.context', style: { 'opacity': 0.35 } },
        { selector: 'node.selected', style: { 'border-width': 4, 'border-color': '#244b3c',
          'background-color': '#edf4e7', 'opacity': 1, 'z-index': 5 } },
        { selector: 'node.selection-neighbor', style: { 'border-width': 3, 'background-color': '#f1f6ea', 'opacity': 1, 'z-index': 4 } },
        { selector: 'node.selection-muted', style: { 'opacity': 0.22 } },
        { selector: 'edge', style: { 'width': 1.6, 'line-color': '#9ba8b2', 'curve-style': 'bezier',
          'target-arrow-color': '#9ba8b2', 'arrow-scale': 1.1, 'overlay-opacity': 0 } },
        { selector: 'edge.blocks', style: { 'line-color': '#b4543e', 'target-arrow-color': '#b4543e',
          'target-arrow-shape': 'triangle', 'width': 2.2 } },
        { selector: 'edge.parent', style: { 'line-style': 'dashed', 'line-color': '#5d7d9c',
          'target-arrow-color': '#5d7d9c', 'target-arrow-shape': 'vee', 'width': 2 } },
        { selector: 'edge.duplicate', style: { 'line-color': '#885c9b', 'target-arrow-color': '#885c9b',
          'target-arrow-shape': 'diamond', 'line-style': 'dotted', 'width': 2.5 } },
        { selector: 'edge.highlighted', style: { 'width': 3.5, 'opacity': 1, 'z-index': 4 } },
        { selector: 'edge.selection-muted', style: { 'opacity': 0.12 } },
        { selector: 'node.connection-source, node.connection-target', style: { 'border-color': '#244b3c',
          'border-width': 5, 'background-color': '#e8f0df' } },
        { selector: 'node.connection-cursor', style: { width: 1, height: 1, opacity: 0, events: 'no' } },
        { selector: 'edge.connection-preview', style: { 'line-color': '#244b3c', 'line-style': 'dashed',
          'target-arrow-color': '#244b3c', 'target-arrow-shape': 'triangle', width: 3, events: 'no' } },
      ],
    });
    core.current = cy;
    cy.on('dragfree', 'node', remember);
    setOverlayCore(cy);
    const removeMousePanning = installMousePanning(surface.current!, cy);
    const coarse = window.matchMedia('(pointer: coarse)');
    const grabbing = () => cy.autoungrabify(coarse.matches || latest.current.connecting);
    coarse.addEventListener('change', grabbing); grabbing();
    let gesture: { source: string; id: string; start: { x: number; y: number }; moved: boolean } | null = null;
    let suppressTapUntil = 0;
    const clearGesture = () => {
      cy.elements('.connection-preview, .connection-cursor').remove();
      cy.nodes().removeClass('connection-target');
      gesture = null; cy.userPanningEnabled(true);
    };
    const targetAt = (position: { x: number; y: number }, sourceId: string) => cy.nodes('.ticket').filter(node => {
      const box = node.boundingBox();
      return node.id() !== sourceId && node.data('canLink') && position.x >= box.x1 && position.x <= box.x2 &&
        position.y >= box.y1 && position.y <= box.y2;
    }).first();
    cy.on('tapstart', 'node.ticket', event => {
      if (!latest.current.connecting || !event.target.data('canLink')) return;
      gesture = { source: event.target.data('iid'), id: event.target.id(), start: event.position, moved: false };
      cy.userPanningEnabled(false);
    });
    cy.on('tapdrag', event => {
      if (!gesture || !latest.current.connecting) return;
      const distance = Math.hypot(event.position.x - gesture.start.x, event.position.y - gesture.start.y) * cy.zoom();
      if (!gesture.moved && distance < 12) return;
      if (!gesture.moved) {
        gesture.moved = true;
        cy.add([{ data: { id: '__connection_cursor' }, position: event.position, classes: 'connection-cursor' },
          { data: { id: '__connection_preview', source: gesture.id, target: '__connection_cursor' }, classes: 'connection-preview' }]);
      }
      cy.getElementById('__connection_cursor').position(event.position);
      cy.nodes().removeClass('connection-target'); targetAt(event.position, gesture.id).addClass('connection-target');
    });
    cy.on('tapend', event => {
      if (!gesture) return;
      if (!latest.current.connecting) { clearGesture(); return; }
      const target = gesture.moved ? targetAt(event.position, gesture.id) : null;
      const source = gesture.source;
      const moved = gesture.moved;
      clearGesture();
      if (moved) suppressTapUntil = performance.now() + 350;
      if (target?.length) latest.current.connect(source, target.data('iid'));
    });
    const multitouch = (event: TouchEvent) => { if (event.touches.length > 1) clearGesture(); };
    container.current!.addEventListener('touchstart', multitouch, { passive: true });
    cy.on('tap', 'node', event => {
      const data = event.target.data();
      if (performance.now() < suppressTapUntil) return;
      if (data.theme) latest.current.theme(data.theme);
      else if (data.external) {
        const url = safeGitLabUrl(data.webUrl, latest.current.workspace.gitlabUrl);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      } else if (latest.current.connecting) {
        if (data.canLink) latest.current.select(data.iid);
      } else latest.current.select(data.iid);
    });
    cy.on('tap', event => {
      if (event.target === cy && latest.current.state.selected && !latest.current.connecting)
        latest.current.select('');
    });
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(container.current!);
    return () => { observer.disconnect(); removeMousePanning(); removeWheelNormalization(); coarse.removeEventListener('change', grabbing);
      container.current?.removeEventListener('touchstart', multitouch);
      cy.destroy(); core.current = null; activeView.current = ''; };
  }, []);

  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    const { workspace, matched, state } = props;
    let elements: ElementDefinition[];
    if (state.view === 'themes' && !state.theme) {
      const counts = new Map<string, number>();
      for (const issue of matched) for (const label of issue.labels)
        counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
      elements = workspace.labels.filter(label => counts.has(label.id)).map(label => ({
        data: { id: `theme:${label.id}`, theme: label.id, color: label.color,
          label: `${label.name}\n${counts.get(label.id)} Tickets` }, classes: 'theme',
      }));
    } else {
      const graph = visibleGraph(workspace, matched, state);
      const nodes: ElementDefinition[] = graph.nodes.map(issue => {
        const children = workspace.relations.filter(edge => edge.kind === 'parent' && edge.source === issue.id).length;
        const title = issue.title.length > 128 ? `${issue.title.slice(0, 125)}…` : issue.title;
        return { data: { id: issue.id, iid: issue.iid, color: issue.status?.color ?? '#87928e',
          canLink: issue.canLink,
          label: `${title}${state.view === 'hierarchy' && children && state.collapsed.includes(issue.id) ? `\n+ ${children} Untertickets` : ''}` },
          classes: `ticket ${!graph.matchIds.has(issue.id) ? 'context' : ''}` };
      });
      const references: ElementDefinition[] = graph.references.map(item => ({ data: { ...item, external: true,
        color: '#a4adb3', shortLabel: `Extern\n#${item.iid}`, label: `Extern · #${item.iid}\n${item.title.slice(0, 80)}` }, classes: 'external context' }));
      elements = [...nodes, ...references, ...graph.relations.map(edge => ({ data: { ...edge }, classes: edge.kind }))];
    }
    const key = positionKey(workspace.project, state, workspace.gitlabUrl);
    const switched = activeView.current !== key;
    const saved = positions.current!.read(key);
    activeView.current = key;
    const added = new Set<string>();
    cy.batch(() => {
      const keep = new Set(elements.map(element => element.data.id));
      cy.elements().filter(element => !keep.has(element.id())).remove();
      for (const element of elements) {
        const existing = cy.getElementById(element.data.id!);
        if (existing.length) { existing.data(element.data); existing.classes(element.classes ?? ''); }
        else { cy.add(element); if (!element.data.source) added.add(element.data.id!); }
      }
      const selected = workspace.issues.find(issue => issue.iid === state.selected)?.id;
      if (selected) {
        const node = cy.getElementById(selected);
        if (node.length) {
          const edges = node.connectedEdges();
          const neighbors = edges.connectedNodes().difference(node);
          node.addClass('selected'); neighbors.addClass('selection-neighbor');
          edges.addClass('highlighted');
          cy.nodes().difference(node.union(neighbors)).addClass('selection-muted');
          cy.edges().difference(edges).addClass('selection-muted');
        }
      }
    });
    const nodes = cy.nodes('.ticket, .external, .theme');
    const placed = props.placement !== appliedPlacement.current && props.placement &&
      workspace.issues.find(issue => issue.iid === props.placement!.iid);
    const placementNode = placed && cy.getElementById(placed.id);
    const applyPlacement = placementNode && placementNode.length;
    if (switched || added.size || applyPlacement) {
      // Hidden cards keep their coordinates. Only a new view or an explicit command arranges a whole map.
      if (!saved.size) arrange();
      else {
        nodes.forEach(node => {
          const point = saved.get(node.id());
          if (point && (switched || added.has(node.id()))) node.position(point);
        });
        const known = new Map(saved);
        nodes.forEach(node => { if (saved.has(node.id())) known.set(node.id(), { ...node.position() }); });
        const occupied = [...known.values()];
        if (applyPlacement) occupied.push(props.placement!.point);
        nodes.filter(node => !saved.has(node.id()) && (!applyPlacement || node.id() !== placed.id)).forEach(node => {
          const neighbor = node.neighborhood().nodes().filter(other => saved.has(other.id())).first();
          const anchor = neighbor.length ? known.get(neighbor.id())! : { x: Math.max(0, ...occupied.map(point => point.x)), y: 0 };
          const point = { x: anchor.x + 360, y: anchor.y };
          while (occupied.some(other => Math.abs(other.x - point.x) < 330 && Math.abs(other.y - point.y) < 270))
            point.y += 290;
          node.position(point); occupied.push(point);
        });
        if (switched) { if (state.overview) cy.fit(undefined, 45); else readable(); }
      }
      if (applyPlacement) {
        placementNode.position(props.placement!.point); appliedPlacement.current = props.placement;
        const rendered = placementNode.renderedPosition();
        if (rendered.x < 0 || rendered.y < 0 || rendered.x > cy.width() || rendered.y > cy.height()) cy.center(placementNode);
      }
      remember();
    }
  }, [props.workspace, props.matched, props.state, props.placement]);

  useEffect(() => { if (props.state.overview) core.current?.fit(undefined, 45); else readable(); }, [props.state.overview]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.autoungrabify(window.matchMedia('(pointer: coarse)').matches || props.connecting);
    cy.nodes().removeClass('connection-source');
    const source = props.workspace.issues.find(issue => issue.iid === props.connectionSource);
    if (props.connecting && source) cy.getElementById(source.id).addClass('connection-source');
    if (!props.connecting) { cy.elements('.connection-preview, .connection-cursor').remove(); cy.userPanningEnabled(true); }
  }, [props.connecting, props.connectionSource, props.workspace, props.state, props.matched]);

  return <div ref={surface} className="graph-surface">
    <div ref={container} className="graph-canvas" role="img"
      aria-label="Interaktiver Ticketgraph. Alle Tickets sind auch über die Ergebnisliste erreichbar." data-testid="graph" />
    {storageNotice && <div className="graph-storage-notice action-notice" role="status">{storageNotice}</div>}
    {overlayCore && surface.current && <NodeControls cy={overlayCore} surface={surface.current} issues={props.workspace.issues}
      connect={props.connect} create={props.create} labels={props.labels} open={props.select} start={props.start} />}
  </div>;
});
