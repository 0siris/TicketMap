import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, Link2, Tags, UserRound, UserRoundMinus } from 'lucide-react';
import type { Core } from 'cytoscape';
import type { DropPosition, Issue } from '../shared/types.js';

interface NodePosition { id: string; iid: string; x: number; y: number; width: number; height: number;
  context: boolean; muted: boolean; emphasized: boolean }
export function NodeControls({ cy, surface, issues, connect, create, labels, open, start }: {
  cy: Core; surface: HTMLDivElement; issues: Issue[];
  connect: (from: string, to: string) => void; create: (iid: string, point: DropPosition) => void;
  labels: (iid: string) => void; open: (iid: string) => void; start: (iid: string) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<NodePosition[]>([]);
  const [showActions, setShowActions] = useState(true);
  const refreshFocus = useRef<(() => void) | null>(null);
  const drag = useRef<{ iid: string; id: string; pointerId: number; element: HTMLButtonElement;
    clientX: number; clientY: number; moved: boolean } | null>(null);
  const point = (clientX: number, clientY: number): DropPosition => {
    const rect = surface.getBoundingClientRect(); const pan = cy.pan(); const zoom = cy.zoom();
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom };
  };
  function cancel() {
    const current = drag.current; drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    cy.elements('.port-cursor, .port-preview').remove(); cy.nodes().removeClass('connection-target');
    cy.userPanningEnabled(true);
  }
  useEffect(() => {
    let frame = 0;
    const viewport = () => {
      const pan = cy.pan(); const zoom = cy.zoom();
      if (layer.current) {
        layer.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        layer.current.style.setProperty('--action-scale', String(1 / Math.min(1, zoom)));
      }
      setShowActions(zoom >= 0.5);
      const bounds = surface.getBoundingClientRect();
      for (const button of layer.current?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
        const box = button.getBoundingClientRect();
        const visible = box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
        button.tabIndex = visible ? 0 : -1;
        button.style.visibility = visible ? '' : 'hidden';
      }
    };
    const positions = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setNodes(cy.nodes('.ticket').map(node => ({ id: node.id(), iid: node.data('iid'), ...node.position(),
          width: node.width(), height: node.height(), context: node.hasClass('context'),
          muted: node.hasClass('selection-muted'), emphasized: node.hasClass('selected') || node.hasClass('selection-neighbor') })));
        viewport();
      });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    cy.on('pan zoom resize', viewport); cy.on('position add remove layoutstop class', positions);
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
    refreshFocus.current = viewport; positions(); viewport();
    return () => { cancelAnimationFrame(frame); cancel(); cy.off('pan zoom resize', viewport);
      cy.off('position add remove layoutstop class', positions);
      window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); refreshFocus.current = null; };
  }, [cy]);
  useLayoutEffect(() => { refreshFocus.current?.(); }, [nodes, issues, showActions]);
  return <div ref={layer} className="node-ui-layer" aria-label="Kartenaktionen">
    {nodes.map(node => {
      const issue = issues.find(issue => issue.id === node.id);
      if (!issue) return null;
      const assignees = issue.assignees.map(person => person.name);
      const assignment = assignees.length ? `Zugewiesen: ${assignees.join(', ')}` : 'Nicht zugewiesen';
      return <div key={node.id} className={`node-ui ${node.context ? 'node-ui-context' : ''} ${node.muted ? 'node-ui-muted' : ''} ${node.emphasized ? 'node-ui-emphasized' : ''}`} data-testid={`card-controls-${issue.iid}`}
        style={{ left: node.x - node.width / 2, top: node.y - node.height / 2, width: node.width, height: node.height }}>
        <div className="node-status-marker"><strong>#{issue.iid}</strong><i style={{ background: issue.status?.color ?? '#87928e' }} />{issue.status?.name ?? issue.state}</div>
        <div className="node-card-footer">
          <div className={`node-assignee ${assignees.length ? 'assigned' : ''}`} role="img"
            aria-label={assignment} title={assignment}>
            {assignees.length ? <UserRound size={13} aria-hidden="true" /> : <UserRoundMinus size={13} aria-hidden="true" />}
            <span>{assignees[0] ?? 'Nicht zugewiesen'}</span>
            {assignees.length > 1 && <strong>+{assignees.length - 1}</strong>}
          </div>
        {(issue.labels.length > 0 || issue.typeName === 'Task') && <div className="node-markers"
          aria-label={`Labels von #${issue.iid}: ${issue.labels.map(label => label.name).join(', ')}`}>
          {issue.typeName === 'Task' && <span className="node-label-marker">Unteraufgabe</span>}
          {issue.labels.slice(0, 3).map(label => <span key={label.id} className="node-label-marker" title={label.name}>
            <i style={{ background: label.color }} /><span>{label.name}</span></span>)}
          {issue.labels.length > 3 && <span className="node-label-overflow" title={issue.labels.map(label => label.name).join(', ')}>+{issue.labels.length - 3}</span>}
        </div>}
        </div>
        {showActions && <>
          <div className="node-quick-actions">
            <button aria-label={`Ticket #${issue.iid} öffnen`} title={`Ticket öffnen · ${assignment}`} onClick={() => open(issue.iid)}><Eye size={15} /></button>
            <button aria-label={`Labels für #${issue.iid} bearbeiten`} title={`Labels bearbeiten: ${issue.labels.map(label => label.name).join(', ') || 'Keine Labels'}`} disabled={!issue.canSetMetadata}
              onClick={() => labels(issue.iid)}><Tags size={15} /></button>
          </div>
          <button className="node-port" aria-label={`Verbindung von #${issue.iid} ziehen`} title="Ziehen: verbinden oder neue Unteraufgabe anlegen"
            disabled={!issue.canLink && !issue.canAddChild}
            onClick={event => { if (event.detail === 0) start(issue.iid); }}
            onPointerDown={event => {
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              event.preventDefault(); event.stopPropagation();
              drag.current = { iid: issue.iid, id: issue.id, pointerId: event.pointerId, element: event.currentTarget,
                clientX: event.clientX, clientY: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId); cy.userPanningEnabled(false);
            }}
            onPointerMove={event => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              if (!current.moved && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < 8) return;
              const position = point(event.clientX, event.clientY);
              if (!current.moved) {
                current.moved = true;
                cy.add([{ data: { id: '__port_cursor', color: '#244b3c', label: '' }, position, classes: 'port-cursor connection-cursor' },
                  { data: { id: '__port_preview', source: current.id, target: '__port_cursor' }, classes: 'port-preview connection-preview' }]);
              }
              cy.getElementById('__port_cursor').position(position);
              cy.nodes().removeClass('connection-target');
              cy.nodes('.ticket').filter(target => {
                const box = target.boundingBox(); return target.id() !== current.id && target.data('canLink') &&
                  position.x >= box.x1 && position.x <= box.x2 && position.y >= box.y1 && position.y <= box.y2;
              }).addClass('connection-target');
            }}
            onPointerUp={event => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const position = point(event.clientX, event.clientY);
              const hit = cy.nodes().filter(target => {
                if (target.hasClass('port-cursor')) return false;
                const box = target.boundingBox(); return position.x >= box.x1 && position.x <= box.x2 &&
                  position.y >= box.y1 && position.y <= box.y2;
              }).first();
              const rect = surface.getBoundingClientRect();
              const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
              cancel();
              if (!current.moved) start(current.iid);
              else if (hit.length && hit.id() !== current.id && hit.hasClass('ticket') && hit.data('canLink')) connect(current.iid, hit.data('iid'));
              else if (!hit.length && inside) create(current.iid, position);
            }}
            onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}><Link2 size={15} /></button>
        </>}
      </div>;
    })}
  </div>;
}
