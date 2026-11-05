import { useEffect, useRef, useState } from 'react';
import { GitBranch, Plus, X } from 'lucide-react';
import type { CreatedConnection, CreationOptions, NewConnectionKind, Workspace } from '../shared/types.js';
import { newOperationId, request, RequestError, safeGitLabUrl } from './api.js';

export function CreateCardDialog({ sourceIid, workspace, close, created }: {
  sourceIid?: string; workspace: Workspace; close: () => void; created: (result: CreatedConnection) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<CreationOptions | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [kind, setKind] = useState<NewConnectionKind>('subtask');
  const [operationId, setOperationId] = useState(newOperationId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setOptions(null); setError('');
    request<CreationOptions>(sourceIid ? `/api/issues/${sourceIid}/creation-options` : '/api/issues/creation-options', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setOptions(value); setOperationId(newOperationId());
        if (!value.canCreateSubtask) setKind('relates_to'); } })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [sourceIid, reload]);
  const allowed = options && (sourceIid && kind === 'subtask' ? options.canCreateSubtask : options.canCreateIssue);
  async function save() {
    if (!options || !allowed || saving || !title.trim() || uncertain) return;
    setSaving(true); setError('');
    try {
      const result = await request<CreatedConnection>(sourceIid ? `/api/issues/${sourceIid}/children` : '/api/issues', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId,
          title: title.trim(), description, labelIds: labels,
          ...(sourceIid ? { expectedSourceUpdatedAt: options.source!.updatedAt, kind } : {}) }),
      }, workspace);
      await created(result);
    } catch (error) {
      setError((error as Error).message);
      const safeFailure = error instanceof RequestError && [400, 403, 409].includes(error.status);
      if (safeFailure) setOptions(null); else setUncertain(true);
    } finally { setSaving(false); }
  }
  return <dialog ref={dialog} className="connection-dialog create-card-dialog" aria-labelledby="new-card-title"
    onCancel={event => { event.preventDefault(); if (!saving) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className="connection-heading"><div><Plus size={21} /><h2 id="new-card-title">{sourceIid ? 'Verbundene Karte erstellen' : 'Neues Ticket erstellen'}</h2></div>
        <button type="button" className="icon-button" aria-label="Erstellung schließen" disabled={saving} onClick={close}><X size={19} /></button></header>
      <div className="connection-content">
        {sourceIid ? <p className="connection-intro">Ausgangsticket <strong>#{sourceIid} {options?.source?.title ?? workspace.issues.find(issue => issue.iid === sourceIid)?.title}</strong></p> : <p className="connection-intro">Neues Ticket in <strong>{workspace.project}</strong></p>}
        <label className="field">Titel der neuen Karte<input autoFocus aria-label="Titel der neuen Karte" value={title} maxLength={255}
          disabled={saving || uncertain} onChange={event => setTitle(event.target.value)} required /></label>
        {sourceIid && <label className="field">Beziehung<select aria-label="Beziehung der neuen Karte" value={kind} disabled={saving || uncertain || !options}
          onChange={event => setKind(event.target.value as NewConnectionKind)}>
          <option value="subtask" disabled={!options?.canCreateSubtask}>Unteraufgabe (Task) von #{sourceIid}</option>
          <option value="relates_to" disabled={!options?.canCreateIssue}>Verwandtes Ticket</option>
          <option value="blocks" disabled={!options?.canCreateIssue}>#{sourceIid} blockiert die neue Karte</option>
          <option value="is_blocked_by" disabled={!options?.canCreateIssue}>Neue Karte blockiert #{sourceIid}</option>
        </select></label>}
        {sourceIid && kind === 'subtask' && <p className="creation-hint"><GitBranch size={16} />Die neue Karte wird als echte GitLab-Unteraufgabe angelegt.</p>}
        {sourceIid && options && !options.canCreateSubtask && <p className="creation-hint">Unteraufgaben sind für dieses Ausgangsticket nicht verfügbar. Ein verwandtes Ticket ist vorausgewählt.</p>}
        <label className="field">Beschreibung<textarea aria-label="Beschreibung der neuen Karte" value={description} rows={4}
          disabled={saving || uncertain} onChange={event => setDescription(event.target.value)} /></label>
        <fieldset className="labels-editor" disabled={saving || uncertain}><legend>Labels der neuen Karte</legend>
          <div className="label-options">{workspace.labels.map(label => <label className={`label-choice ${labels.includes(label.id) ? 'checked' : ''}`} key={label.id}>
            <input type="checkbox" checked={labels.includes(label.id)} onChange={event => setLabels(current => event.target.checked
              ? [...current, label.id] : current.filter(id => id !== label.id))} /><span className="label-dot" style={{ background: label.color }} />{label.name}</label>)}</div>
        </fieldset>
        {error && <div className="message error" role="alert">{error}
          {!uncertain && <button type="button" disabled={saving} onClick={() => setReload(value => value + 1)}>{sourceIid ? 'Ausgangsticket neu laden' : 'Erstellungsrechte neu laden'}</button>}</div>}
        {uncertain && <div className="message" role="status">Nicht erneut anlegen: Es könnte bereits eine Karte erstellt worden sein.
          <a href={safeGitLabUrl(`${workspace.gitlabUrl}/${workspace.project}/-/work_items`, workspace.gitlabUrl)} target="_blank" rel="noreferrer">Aktuellen Stand in GitLab prüfen</a></div>}
        {options && !allowed && !error && <p role="alert">Du darfst hier kein Ticket erstellen.</p>}
        {!options && !error && <p role="status">Erstellungsrechte werden geprüft …</p>}
      </div>
      <footer className="connection-footer"><button type="button" disabled={saving} onClick={close}>Abbrechen</button>
        <button type="submit" className="primary" disabled={!allowed || !title.trim() || saving || uncertain}>
          {saving ? 'Erstellt …' : sourceIid && kind === 'subtask' ? 'Unteraufgabe in GitLab erstellen' : 'Ticket in GitLab erstellen'}</button></footer>
    </form>
  </dialog>;
}
