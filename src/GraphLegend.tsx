import { useEffect, useRef } from 'react';
import { ChevronUp, Info } from 'lucide-react';
import type { RelationKind } from '../shared/types.js';

const entries: { kind: RelationKind; color: string; title: string; explanation: string }[] = [
  { kind: 'relates_to', color: '#9ba8b2', title: 'A ist verwandt mit B',
    explanation: 'Graue Linie ohne Pfeil: Die Tickets gehören zusammen. Es gibt keine Richtung.' },
  { kind: 'blocks', color: '#b4543e', title: 'A blockiert B',
    explanation: 'Roter Pfeil von A zu B: B wartet auf A. Die Pfeilspitze zeigt auf das blockierte Ticket.' },
  { kind: 'parent', color: '#5d7d9c', title: 'A ist Elternteil von B',
    explanation: 'Blauer, gestrichelter Pfeil: A ist das übergeordnete Ticket, B das Unterticket.' },
  { kind: 'duplicate', color: '#885c9b', title: 'A ist ein Duplikat von B',
    explanation: 'Violetter, gepunkteter Pfeil mit Raute: A ist das Duplikat. B ist das Original.' },
];

function Example({ kind, color }: { kind: RelationKind; color: string }) {
  return <svg className="legend-example" viewBox="0 0 140 40" aria-hidden="true">
    <rect x="1" y="6" width="27" height="28" rx="4" fill="white" stroke="#bfc9c2" />
    <text x="14.5" y="24" textAnchor="middle" fill="#28332e">A</text>
    <line x1="30" y1="20" x2={kind === 'duplicate' ? 99 : 105} y2="20" stroke={color} strokeWidth="2.5"
      strokeDasharray={kind === 'parent' ? '7 5' : kind === 'duplicate' ? '2 5' : undefined} />
    {kind === 'blocks' && <path d="M95 14 L106 20 L95 26 Z" fill={color} />}
    {kind === 'parent' && <path d="M97 14 L105 20 L97 26" fill="none" stroke={color} strokeWidth="2.5" />}
    {kind === 'duplicate' && <path d="M98 20 L104 14 L110 20 L104 26 Z" fill={color} />}
    <rect x="112" y="6" width="27" height="28" rx="4" fill="white" stroke="#bfc9c2" />
    <text x="125.5" y="24" textAnchor="middle" fill="#28332e">B</text>
  </svg>;
}

export function GraphLegend() {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false;
        details.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  return <details ref={details} className="graph-legend">
    <summary><Info size={17} /><strong>Legende</strong><span>Pfeile und Beziehungen</span><ChevronUp size={16} /></summary>
    <section className="legend-panel" aria-label="Pfeillegende">
      <h3>So liest du die Verbindungen</h3>
      <p>A und B stehen für zwei Ticketkarten.</p>
      <dl>{entries.map(entry => <div className="legend-entry" key={entry.kind}>
        <Example kind={entry.kind} color={entry.color} />
        <div><dt>{entry.title}</dt><dd>{entry.explanation}</dd></div>
      </div>)}</dl>
      <p className="legend-note">Die farbige Umrandung einer Karte zeigt ihren GitLab-Status. Sie ist unabhängig von der Farbe der Verbindung.</p>
    </section>
  </details>;
}
