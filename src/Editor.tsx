import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Check, Eye, FilePenLine, Link2, Save, X } from 'lucide-react';
import type { Issue, IssuePatch, Workspace } from '../shared/types.js';
import { request, RequestError, safeGitLabUrl, safeMarkdownUrl } from './api.js';
import { type Draft, rebaseDraft, sameDraft, toDraft } from './draft.js';
import { MarkdownLink, TicketImage } from './TicketImage.js';

interface Props {
  iid: string; workspace: Workspace; close: () => void; select: (iid: string) => void;
  dirty: (value: boolean) => void; saved: (issue: Issue) => Promise<void>;
  connect: (iid: string) => void;
}
export function Editor({ iid, workspace, close, select, dirty, saved, connect }: Props) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Issue | null>(null);
  const [preview, setPreview] = useState(true);
  const [notice, setNotice] = useState('');
  const dirtyCallback = useRef(dirty);
  dirtyCallback.current = dirty;
  const markdownComponents = useMemo<Components>(() => ({
    a: props => <MarkdownLink {...props} href={safeMarkdownUrl(props.href, issue?.webUrl ?? '')} />,
    img: ({ alt, src }) => <TicketImage key={`${iid}:${src}`} src={src} alt={alt} issueUrl={issue?.webUrl ?? ''} target={workspace} />,
  }), [iid, issue?.webUrl, workspace.gitlabUrl, workspace.project]);
  async function load(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const item = await request<Issue>(`/api/issues/${iid}`, { signal });
      if (signal?.aborted) return;
      setIssue(item); setDraft(toDraft(item)); setConflict(null);
    } catch (error) { if (!signal?.aborted) setError((error as Error).message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setIssue(null); setDraft(null); setNotice(''); setPreview(true);
    void load(controller.signal);
    return () => { controller.abort(); dirtyCallback.current(false); };
  }, [iid]);
  const changed = !!issue && !!draft && !sameDraft(toDraft(issue), draft);
  useEffect(() => { dirtyCallback.current(changed || saving); }, [changed, saving]);

  async function save() {
    if (!issue || !draft || saving) return;
    setSaving(true); setError(''); setNotice('');
    const baseline = toDraft(issue);
    const patch: IssuePatch = { expectedUpdatedAt: issue.updatedAt };
    if (draft.title !== baseline.title) patch.title = draft.title;
    if (draft.description !== baseline.description) patch.description = draft.description;
    if (draft.status !== baseline.status) patch.statusId = draft.status;
    const addLabelIds = draft.labels.filter(id => !baseline.labels.includes(id));
    const removeLabelIds = baseline.labels.filter(id => !draft.labels.includes(id));
    if (addLabelIds.length) patch.addLabelIds = addLabelIds;
    if (removeLabelIds.length) patch.removeLabelIds = removeLabelIds;
    try {
      const updated = await request<Issue>(`/api/issues/${iid}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      }, workspace);
      setIssue(updated); setDraft(toDraft(updated)); setConflict(null); setNotice('In GitLab gespeichert.');
      await saved(updated);
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof RequestError && error.body.current) setConflict(error.body.current);
    } finally { setSaving(false); }
  }

  const related = issue ? workspace.relations.filter(edge => edge.source === issue.id || edge.target === issue.id) : [];
  return <aside className="editor" aria-label={`Ticket #${iid}`}>
    <header className="panel-heading">
      <div><span className="muted">Ticket</span><strong>#{iid}</strong></div>
      <div className="inline-actions">
        {issue && <a className="icon-button" href={safeGitLabUrl(issue.webUrl, workspace.gitlabUrl)} target="_blank" rel="noreferrer" aria-label="In GitLab öffnen"><ArrowUpRight size={18} /></a>}
        <button className="icon-button" aria-label="Ticket schließen" disabled={saving} onClick={close}><X size={18} /></button>
      </div>
    </header>
    {loading && <div className="editor-content" aria-busy="true"><div className="skeleton" /><div className="skeleton tall" /></div>}
    {error && <div className="message error" role="alert">{error}
      {!issue && !loading && <button onClick={() => void load()}>Erneut laden</button>}
    </div>}
    {!loading && issue && draft && <>
      <div className="editor-content">
        {!issue.canEdit && !issue.canSetMetadata && <div className="message">Du hast für dieses Ticket nur Leserechte.</div>}
        {conflict && <div className="message conflict" role="alert">
          <strong>Neuerer GitLab-Stand</strong>
          <p>{conflict.title}<br />Status: {conflict.status?.name ?? conflict.state}</p>
          <details><summary>Aktuelle Beschreibung anzeigen</summary><pre>{conflict.description}</pre></details>
          <button disabled={saving} onClick={() => {
            setDraft(rebaseDraft(issue, draft, conflict)); setIssue(conflict); setConflict(null); setError('');
            setNotice('Deine Änderungen übernommen. Unveränderte Felder verwenden den aktuellen GitLab-Stand.'); }}>
            Entwurf auf aktuellem Stand weiterbearbeiten
          </button>
          <button disabled={saving} onClick={() => {
            if (window.confirm('Entwurf verwerfen und den aktuellen GitLab-Stand laden?')) {
              setIssue(conflict); setDraft(toDraft(conflict)); setConflict(null); setError('');
            }
          }}>GitLab-Stand übernehmen</button>
        </div>}
        <label className="field">Titel<input aria-label="Titel" value={draft.title} maxLength={1024}
          disabled={!issue.canEdit || saving} onChange={event => { setDraft({ ...draft, title: event.target.value }); setNotice(''); }} /></label>
        <label className="field">Status<select aria-label="Status" value={draft.status} disabled={!issue.canSetMetadata || saving}
          onChange={event => { setDraft({ ...draft, status: event.target.value }); setNotice(''); }}>
          {!draft.status && <option value="" disabled>Kein Status</option>}
          {workspace.statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select></label>
        <fieldset className="labels-editor" disabled={!issue.canSetMetadata || saving}>
          <legend>Labels <span className="muted">{draft.labels.length}</span></legend>
          <div className="label-options">{workspace.labels.map(label => <label key={label.id}
            className={`label-choice ${draft.labels.includes(label.id) ? 'checked' : ''}`}>
            <input type="checkbox" checked={draft.labels.includes(label.id)} onChange={event => {
              setDraft({ ...draft, labels: event.target.checked ? [...draft.labels, label.id] : draft.labels.filter(id => id !== label.id) });
              setNotice('');
            }} /><span className="label-dot" style={{ background: label.color }} />{label.name}
          </label>)}</div>
        </fieldset>
        <div className="description-heading"><label htmlFor="description">Beschreibung</label>
          <div className="segmented compact" aria-label="Beschreibung anzeigen oder bearbeiten">
            <button aria-pressed={preview} onClick={() => setPreview(true)}><Eye size={14} /> Vorschau</button>
            <button aria-pressed={!preview} onClick={() => setPreview(false)}><FilePenLine size={14} /> Markdown</button>
          </div>
        </div>
        {preview ? <div className="markdown" data-testid="description-preview">
          {draft.description ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
            components={markdownComponents}>
            {draft.description}</ReactMarkdown> : <p className="muted">Noch keine Beschreibung.</p>}
        </div> : <textarea id="description" aria-label="Beschreibung" value={draft.description}
          disabled={!issue.canEdit || saving} onChange={event => { setDraft({ ...draft, description: event.target.value }); setNotice(''); }} />}
        <dl className="metadata"><div><dt>Verantwortlich</dt><dd>{issue.assignees.map(person => person.name).join(', ') || 'Nicht zugewiesen'}</dd></div>
          <div><dt>Meilenstein</dt><dd>{issue.milestone?.title ?? 'Keiner'}</dd></div>
          <div><dt>Geändert</dt><dd>{new Date(issue.updatedAt).toLocaleString('de-DE')}</dd></div></dl>
        <section className="relationships"><h3>Beziehungen <span className="muted">{related.length}</span></h3>
          <button className="new-connection" disabled={!issue.canLink || saving} onClick={() => connect(issue.iid)}><Link2 size={15} />Ticket verbinden</button>
          {!related.length && <p className="muted">Keine verknüpften Tickets.</p>}
          {related.map(edge => {
            const outgoing = edge.source === issue.id;
            const id = outgoing ? edge.target : edge.source;
            const target = workspace.issues.find(item => item.id === id);
            const reference = target ?? workspace.references.find(item => item.id === id);
            const caption = edge.kind === 'duplicate' ? (outgoing ? 'Duplikat von' : 'Hat Duplikat') : edge.kind === 'parent' ? (outgoing ? 'Unterticket' : 'Elternticket')
              : edge.kind === 'blocks' ? (outgoing ? 'Blockiert' : 'Blockiert durch') : 'Verknüpft';
            return <div className="relationship" key={edge.id}><span>{caption}</span>
              {target ? <button disabled={saving} onClick={() => select(target.iid)}>#{target.iid} {target.title}</button>
                : <a href={safeGitLabUrl(reference?.webUrl ?? '', workspace.gitlabUrl)} target="_blank" rel="noreferrer">Extern: {reference?.title ?? id}</a>}</div>;
          })}
        </section>
      </div>
      <footer className="editor-footer">
        <div className="save-notice" role="status">{notice ? <><Check size={15} />{notice}</> : changed ? 'Ungespeicherte Änderungen' : 'Aktueller GitLab-Stand'}</div>
        <div className="footer-actions"><button disabled={!changed || saving} onClick={() => {
          if (window.confirm('Ungespeicherte Änderungen verwerfen?')) { setDraft(toDraft(issue)); setError(''); setConflict(null); setNotice(''); }
        }}>Verwerfen</button>
          <button className="primary" disabled={!changed || saving || !draft.title.trim() || !!conflict}
            onClick={() => void save()}><Save size={16} />{saving ? 'Speichert …' : 'In GitLab speichern'}</button></div>
      </footer>
    </>}
  </aside>;
}
