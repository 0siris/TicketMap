import { useEffect, useRef, useState } from 'react';
import { Search, Tags, X } from 'lucide-react';
import type { Issue, Workspace } from '../shared/types.js';
import { request, RequestError } from './api.js';

export function QuickLabels({ iid, workspace, close, saved }: {
  iid: string; workspace: Workspace; close: () => void; saved: (issue: Issue) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setIssue(null); setError('');
    request<Issue>(`/api/issues/${iid}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setIssue(value); setSelected(value.labels.map(label => label.id)); }
    }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [iid, reload]);
  const labels = workspace.labels.filter(label => label.name.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  const add = selected.filter(id => !issue?.labels.some(label => label.id === id));
  const remove = issue?.labels.filter(label => !selected.includes(label.id)).map(label => label.id) ?? [];
  async function save() {
    if (!issue?.canSetMetadata || saving) return;
    setSaving(true); setError('');
    try {
      const updated = await request<Issue>(`/api/issues/${iid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: issue.updatedAt, ...(add.length ? { addLabelIds: add } : {}),
          ...(remove.length ? { removeLabelIds: remove } : {}) }) }, workspace);
      await saved(updated); close();
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof RequestError && error.status === 409) setIssue(null);
    } finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="connection-dialog quick-label-dialog" aria-labelledby="quick-label-title"
    onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className="connection-heading"><div><Tags size={20} /><h2 id="quick-label-title">Labels für #{iid}</h2></div>
        <button type="button" className="icon-button" aria-label="Labelauswahl schließen" disabled={saving} onClick={close}><X size={19} /></button></header>
      <div className="connection-content"><p className="connection-intro">{issue?.title ?? workspace.issues.find(value => value.iid === iid)?.title}</p>
        <label className="target-search"><Search size={17} /><input autoFocus type="search" aria-label="Labels suchen" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="Label suchen" /></label>
        <fieldset className="quick-label-list" disabled={!issue?.canSetMetadata || saving}><legend>{selected.length} Labels ausgewählt</legend>
          {labels.map(label => <label className="check-option" key={label.id}><input type="checkbox" checked={selected.includes(label.id)}
            onChange={event => setSelected(current => event.target.checked ? [...current, label.id] : current.filter(id => id !== label.id))} />
            <span className="label-dot" style={{ background: label.color }} />{label.name}</label>)}
        </fieldset>
        {issue && !issue.canSetMetadata && <p role="status">Du hast keine Berechtigung zum Ändern dieser Labels.</p>}
        {error && <div className="message error" role="alert">{error}<button type="button" disabled={saving} onClick={() => {
          if (window.confirm('Aktuellen GitLab-Stand laden und die Labelauswahl verwerfen?')) setReload(value => value + 1);
        }}>Aktuellen Stand laden</button></div>}
        {!issue && !error && <p role="status">Labels werden geladen …</p>}
      </div>
      <footer className="connection-footer"><button type="button" disabled={saving} onClick={close}>Abbrechen</button>
        <button type="submit" className="primary" disabled={!issue?.canSetMetadata || saving || (!add.length && !remove.length)}>
          {saving ? 'Speichert …' : 'Labels speichern'}</button></footer>
    </form>
  </dialog>;
}
