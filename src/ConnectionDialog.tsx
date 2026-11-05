import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpDown, Copy, Link2, Search, X } from 'lucide-react';
import type { ConnectionInput, ConnectionKind, Issue, Workspace } from '../shared/types.js';
import { request } from './api.js';

const choices: { kind: ConnectionKind; title: string; hint: string }[] = [
  { kind: 'relates_to', title: 'Verwandt', hint: 'Die Tickets gehören zusammen. Keine Richtung, kein Statuswechsel.' },
  { kind: 'blocks', title: 'Blockiert', hint: 'Das Ausgangsticket muss vor dem Zielticket erledigt werden.' },
  { kind: 'is_blocked_by', title: 'Wird blockiert durch', hint: 'Das Zielticket muss vor dem Ausgangsticket erledigt werden.' },
  { kind: 'duplicate', title: 'Duplikat von', hint: 'Das Ausgangsticket wird geschlossen. Das Zielticket bleibt das Original.' },
];

export function ConnectionDialog({ workspace, initialSource, initialTarget, close, saved }: {
  workspace: Workspace; initialSource: string; initialTarget: string; close: () => void;
  saved: (workspace: Workspace, message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sourceIid, setSourceIid] = useState(initialSource);
  const [targetIid, setTargetIid] = useState(initialTarget);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ConnectionKind>('relates_to');
  const [details, setDetails] = useState<{ source: Issue; target: Issue } | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const source = details?.source ?? workspace.issues.find(issue => issue.iid === sourceIid);
  const target = details?.target ?? workspace.issues.find(issue => issue.iid === targetIid);
  const candidates = workspace.issues.filter(issue => issue.iid !== sourceIid && issue.canLink &&
    `#${issue.iid} ${issue.title}`.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de')));
  const duplicateAllowed = source?.canDuplicate && source.state.toLowerCase() !== 'closed' && !source.duplicateOf;
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null); setError(''); setConfirmed(false);
    if (!sourceIid || !targetIid || sourceIid === targetIid) { setLoading(false); return; }
    setLoading(true);
    Promise.all([request<Issue>(`/api/issues/${sourceIid}`, { signal: controller.signal }),
      request<Issue>(`/api/issues/${targetIid}`, { signal: controller.signal })])
      .then(([source, target]) => { if (!controller.signal.aborted) setDetails({ source, target }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceIid, targetIid, reload]);
  async function save() {
    if (!details || saving || (kind === 'duplicate' && !confirmed)) return;
    setSaving(true); setError('');
    const input: ConnectionInput = { targetIid: details.target.iid, kind,
      expectedSourceUpdatedAt: details.source.updatedAt, expectedTargetUpdatedAt: details.target.updatedAt,
      ...(kind === 'duplicate' ? { confirmDuplicate: true } : {}) };
    try {
      const result = await request<Workspace>(`/api/issues/${details.source.iid}/connections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      }, workspace);
      saved(result, kind === 'duplicate'
        ? `Ticket #${details.source.iid} wurde als Duplikat von #${details.target.iid} geschlossen.`
        : `Verbindung zwischen #${details.source.iid} und #${details.target.iid} in GitLab gespeichert.`);
    } catch (error) { setError((error as Error).message); setDetails(null); setConfirmed(false); }
    finally { setSaving(false); }
  }
  const from = kind === 'is_blocked_by' ? target : source;
  const to = kind === 'is_blocked_by' ? source : target;
  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="connection-title"
    onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className="connection-heading"><div><Link2 size={21} /><h2 id="connection-title">Tickets verbinden</h2></div>
        <button type="button" className="icon-button" aria-label="Verbindungsdialog schließen" disabled={saving} onClick={close}><X size={19} /></button></header>
      <div className="connection-content">
        <p className="connection-intro">Wähle die Beziehung. Gespeichert wird direkt in GitLab.</p>
        <div className="connection-pair">
          <label className="field">Ausgangsticket<select aria-label="Ausgangsticket" value={sourceIid} disabled={saving}
            onChange={event => { setSourceIid(event.target.value); if (event.target.value === targetIid) setTargetIid(''); }}>
            <option value="" disabled>Ticket wählen</option>{workspace.issues.filter(issue => issue.canLink).map(issue =>
              <option key={issue.id} value={issue.iid}>#{issue.iid} {issue.title}</option>)}
          </select></label>
          {source && <p className="connection-ticket-title">#{source.iid} <strong>{source.title}</strong></p>}
          <div className="pair-divider"><ArrowDown size={18} /><button type="button" disabled={saving || !targetIid}
            onClick={() => { setSourceIid(targetIid); setTargetIid(sourceIid); }}><ArrowUpDown size={15} />Richtung tauschen</button></div>
          <div className="target-heading"><span>Zielticket</span>{targetIid && <button type="button" disabled={saving} onClick={() => { setTargetIid(''); setQuery(''); }}>Anderes Ticket wählen</button>}</div>
          {target ? <p className="connection-ticket-title target">#{target.iid} <strong>{target.title}</strong></p> : <>
            <label className="target-search"><Search size={17} /><input type="search" aria-label="Zielticket suchen"
              placeholder="Nummer oder Titel suchen" value={query} disabled={saving} onChange={event => setQuery(event.target.value)} /></label>
            <ul className="target-results" aria-label="Mögliche Zieltickets">{candidates.map(issue => <li key={issue.id}>
              <button type="button" disabled={saving} onClick={() => setTargetIid(issue.iid)}><span>#{issue.iid}</span>{issue.title}</button>
            </li>)}{!candidates.length && <li className="empty-results">Kein passendes Ticket mit Verknüpfungsrecht.</li>}</ul>
          </>}
        </div>
        <fieldset className="connection-kinds" disabled={saving}><legend>Was verbindet die Tickets?</legend>
          {choices.map(choice => <label key={choice.kind} className={`connection-kind ${kind === choice.kind ? 'active' : ''}`}>
            <input type="radio" name="connection-kind" value={choice.kind} checked={kind === choice.kind}
              disabled={choice.kind === 'duplicate' && !duplicateAllowed} onChange={() => { setKind(choice.kind); setConfirmed(false); }} />
            <span><strong>{choice.title}</strong><span>{choice.hint}</span></span>
          </label>)}
        </fieldset>
        {source && target && <div className={`connection-summary ${kind === 'duplicate' ? 'duplicate-summary' : ''}`}>
          {kind === 'duplicate' ? <Copy size={18} /> : <Link2 size={18} />}
          <span><strong>#{from?.iid}</strong> {kind === 'duplicate' ? 'ist ein Duplikat von' : kind === 'relates_to' ? 'ist verwandt mit' : 'blockiert'} <strong>#{to?.iid}</strong></span>
          {kind !== 'relates_to' && <ArrowRight size={17} />}
        </div>}
        {kind === 'duplicate' && <label className="duplicate-confirmation"><input type="checkbox" checked={confirmed}
          disabled={!details || saving} onChange={event => setConfirmed(event.target.checked)} />
          <span>Ich bestätige: <strong>Ticket #{sourceIid} wird als Duplikat geschlossen.</strong> Ticket #{targetIid || '…'} bleibt das Original.</span></label>}
        {error && <div className="message error" role="alert">{error}<button type="button" disabled={saving} onClick={() => setReload(value => value + 1)}>Tickets neu laden</button></div>}
        {loading && <p className="connection-loading" role="status">Berechtigungen und aktuellen GitLab-Stand prüfen …</p>}
        {details && (!details.source.canLink || !details.target.canLink) && <p role="alert">Du darfst diese Tickets nicht verbinden.</p>}
      </div>
      <footer className="connection-footer"><button type="button" disabled={saving} onClick={close}>Abbrechen</button>
        <button type="submit" className="primary" disabled={!details || !details.source.canLink || !details.target.canLink || saving || loading ||
          (kind === 'duplicate' && (!duplicateAllowed || !confirmed))}>
          {saving ? 'Speichert …' : kind === 'duplicate' ? 'Als Duplikat schließen' : 'Verbindung in GitLab speichern'}</button></footer>
    </form>
  </dialog>;
}
