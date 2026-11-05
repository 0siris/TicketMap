import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, CircleDot, Filter, Focus, GitBranch,
  Layers, List, Link2, Maximize, Minus, Network, Plus, RefreshCw, RotateCcw, Search, X, Type } from 'lucide-react';
import { gitLabTargetKey, type DropPosition, type Filters, type Issue, type ViewState, type Workspace } from '../shared/types.js';
import { emptyFilters, filterIssues, readView, visibleGraph, writeView } from '../shared/view.js';
import { request, safeGitLabUrl } from './api.js';
import { Editor } from './Editor.js';
import { Graph, type GraphHandle } from './Graph.js';
import { ConnectionDialog } from './ConnectionDialog.js';
import { GraphLegend } from './GraphLegend.js';
import { CreateCardDialog } from './CreateCardDialog.js';
import { QuickLabels } from './QuickLabels.js';

const relationNames = { relates_to: 'Verknüpft', blocks: 'Blockierung', parent: 'Eltern / Unterticket', duplicate: 'Duplikat' };
const stateNames = { network: 'Netz', themes: 'Themen', hierarchy: 'Hierarchie' };
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [state, setState] = useState<ViewState>(() => readView(window.location.search));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionSource, setConnectionSource] = useState('');
  const [connectionPair, setConnectionPair] = useState<{ source: string; target: string } | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [createRequest, setCreateRequest] = useState<{ source?: string; point?: DropPosition } | null>(null);
  const [labelIid, setLabelIid] = useState('');
  const [placement, setPlacement] = useState<{ iid: string; point: DropPosition } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const graph = useRef<GraphHandle>(null);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const loadedTarget = useRef<string | null>(null);
  const stateRef = useRef(state);
  const dirtyRef = useRef(dirty);
  stateRef.current = state;
  dirtyRef.current = dirty;
  const markDirty = useCallback((value: boolean) => setDirty(value), []);

  const reload = useCallback((force = false): Promise<void> => {
    if (pendingRefresh.current) return pendingRefresh.current;
    setBusy(true);
    const pending = (async () => {
      try {
        const data = await request<Workspace>(`/api/workspace${force ? '?refresh=1' : ''}`);
        const target = gitLabTargetKey(data);
        if (loadedTarget.current && loadedTarget.current !== target)
          throw new Error('Das GitLab-Ziel wurde geändert. Bitte die Seite neu laden. Ungespeicherte Entwürfe bleiben bis dahin erhalten.');
        loadedTarget.current = target;
        setWorkspace(data); setError('');
      } catch (error) { setError((error as Error).message); }
      finally { pendingRefresh.current = null; setBusy(false); }
    })();
    pendingRefresh.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(true); }, 60_000);
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  useEffect(() => { window.history.replaceState(null, '', `${window.location.pathname}${writeView(state)}`); }, [state]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    const popState = () => {
      if (dirtyRef.current && !window.confirm('Ungespeicherte Änderungen verwerfen und die Ansicht wechseln?')) {
        window.history.replaceState(null, '', `${window.location.pathname}${writeView(stateRef.current)}`); return;
      }
      setState(readView(window.location.search));
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', popState);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', popState); };
  }, []);

  function select(iid: string) {
    if (connecting && iid) {
      const issue = workspace?.issues.find(issue => issue.iid === iid);
      if (!issue?.canLink) return false;
      if (!connectionSource) setConnectionSource(iid);
      else if (connectionSource !== iid) setConnectionPair({ source: connectionSource, target: iid });
      return true;
    }
    if (iid !== state.selected) {
      if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen und das Ticket wechseln?')) return false;
      setDirty(false);
    }
    setState(current => {
      const ancestors = new Set<string>();
      const selectedId = workspace?.issues.find(issue => issue.iid === iid)?.id;
      const visit = (id: string) => {
        for (const edge of workspace?.relations ?? []) {
          if (edge.kind === 'parent' && edge.target === id && !ancestors.has(edge.source)) {
            ancestors.add(edge.source); visit(edge.source);
          }
        }
      };
      if (selectedId && current.view === 'hierarchy') visit(selectedId);
      return { ...current, selected: iid, collapsed: current.collapsed.filter(id => !ancestors.has(id)) };
    });
    return true;
  }
  function selectResult(issue: Issue) {
    if (!select(issue.iid)) return;
    setFiltersOpen(false);
    if (connecting) return;
    if (state.view === 'themes' && !state.theme)
      setState(current => ({ ...current, view: 'network' }));
    setFocusRequest({ id: issue.id });
  }
  function beginConnection(iid = state.selected) {
    if (state.selected && !select('')) return;
    setConnectionSource(iid); setConnecting(true); setActionNotice('');
    if (state.view === 'themes' && !state.theme) setState(current => ({ ...current, view: 'network' }));
  }
  function cancelConnection() { setConnecting(false); setConnectionSource(''); setConnectionPair(null); }
  function createFromCard(source: string, point: DropPosition) {
    if (state.selected && !select('')) return;
    cancelConnection(); setActionNotice(''); setCreateRequest({ source, point });
  }
  function editCardLabels(iid: string) {
    if (state.selected && !select('')) return;
    cancelConnection(); setLabelIid(iid);
  }
  function filter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setState(current => ({ ...current, filters: { ...current.filters, [key]: value } }));
  }
  const matched = useMemo(() => workspace ? filterIssues(workspace, state.filters) : [], [workspace, state.filters]);
  const visible = useMemo(() => workspace ? visibleGraph(workspace, matched, state) : null, [workspace, matched, state]);
  const people = useMemo(() => [...new Map(workspace?.issues.flatMap(issue => issue.assignees).map(person => [person.id, person]) ?? [])
    .values()].sort((a, b) => a.name.localeCompare(b.name)), [workspace]);
  const milestones = useMemo(() => [...new Map(workspace?.issues.flatMap(issue => issue.milestone ? [issue.milestone] : [])
    .map(milestone => [milestone.id, milestone]) ?? []).values()], [workspace]);
  const selected = workspace?.issues.find(issue => issue.iid === state.selected);
  const hasChildren = workspace?.relations.some(edge => edge.kind === 'parent' && edge.source === selected?.id);
  const activeTheme = workspace?.labels.find(label => label.id === state.theme);
  const filterCount = state.filters.statuses.length + state.filters.labels.length + state.filters.assignees.length +
    state.filters.milestones.length + state.filters.relations.length + (state.filters.query ? 1 : 0);
  const results = [...(visible?.matches ?? [])].sort((a, b) => Number(b.iid) - Number(a.iid));
  const noThemes = state.view === 'themes' && !state.theme && !matched.some(issue => issue.labels.length);

  async function saved(issue: Issue) {
    if (pendingRefresh.current) await pendingRefresh.current;
    setWorkspace(current => current ? { ...current, issues: current.issues.map(item => item.id === issue.id ? issue : item) } : current);
    await reload(true);
  }

  return <div className={`app ${state.selected ? 'with-editor' : ''}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-symbol"><Network size={21} /></span><h1>Ticket Map</h1>
        {workspace && <><span className="brand-separator" /><a
          href={safeGitLabUrl(`${workspace.gitlabUrl}/${workspace.project}/-/issues`, workspace.gitlabUrl)}
          title={workspace.project} target="_blank" rel="noreferrer">
          {workspace.project.split('/').at(-1)} <ArrowUpRight size={13} /></a></>}</div>
      <div className="header-actions"><span className={`connection ${error ? 'offline' : ''}`}><span />
        {error ? 'Abruf fehlgeschlagen' : workspace ? 'Lokal · GitLab verbunden' : 'Verbindet …'}</span>
        <button className="primary" disabled={!workspace} onClick={() => {
          if (state.selected && !select('')) return;
          cancelConnection(); setActionNotice(''); setCreateRequest({});
        }}><Plus size={16} />Neues Ticket</button>
        <button disabled={busy} onClick={() => void reload(true)} title="Daten aus GitLab aktualisieren" aria-label="Aktualisieren">
          <RefreshCw size={15} className={busy ? 'spinning' : ''} /><span>{busy ? 'Lädt …' : 'Aktualisieren'}</span></button></div>
    </header>
    {workspace && <nav className="status-strip" aria-label="Nach Status filtern">
      <button className={!state.filters.statuses.length ? 'active' : ''} onClick={() => filter('statuses', [])}>
        Alle Tickets <strong>{workspace.issues.length}</strong></button>
      {workspace.statuses.map(status => <button key={status.id} className={state.filters.statuses.includes(status.id) ? 'active' : ''}
        aria-pressed={state.filters.statuses.includes(status.id)} onClick={() => filter('statuses', toggle(state.filters.statuses, status.id))}>
        <span className="status-dot" style={{ background: status.color }} />{status.name}
        <strong>{workspace.issues.filter(issue => issue.status?.id === status.id).length}</strong></button>)}
    </nav>}
    {error && <div className="workspace-error message error" role="alert">{error}
      {workspace && ' Die zuletzt geladenen Daten bleiben sichtbar.'}<button disabled={busy} onClick={() => void reload(true)}>Erneut versuchen</button></div>}
    <main className="workspace-layout">
      <aside className={`sidebar ${filtersOpen ? 'mobile-open' : ''}`} aria-label="Filter und Ergebnisse">
        <div className="sidebar-heading"><h2><Filter size={15} />Filter {filterCount > 0 && <span className="count">{filterCount}</span>}</h2>
          <button className="text-button" disabled={!filterCount && !state.theme} onClick={() => setState(current => ({ ...current, theme: '', filters: emptyFilters() }))}>Zurücksetzen</button>
          <button className="icon-button mobile-filter-close" aria-label="Filter schließen" onClick={() => setFiltersOpen(false)}><X size={18} /></button></div>
        <label className="search-field"><Search size={16} /><input type="search" aria-label="Tickets durchsuchen" placeholder="Nummer, Titel, Beschreibung …"
          value={state.filters.query} onChange={event => filter('query', event.target.value)} /></label>
        <div className="filter-groups">
          <FilterGroup title="Labels" count={state.filters.labels.length} defaultOpen>
            {workspace?.labels.map(label => <CheckOption key={label.id} name={label.name} color={label.color}
              checked={state.filters.labels.includes(label.id)} onChange={() => filter('labels', toggle(state.filters.labels, label.id))}
              count={workspace.issues.filter(issue => issue.labels.some(item => item.id === label.id)).length} />)}
          </FilterGroup>
          <FilterGroup title="Verantwortlich" count={state.filters.assignees.length}>
            <CheckOption name="Nicht zugewiesen" checked={state.filters.assignees.includes('none')}
              onChange={() => filter('assignees', toggle(state.filters.assignees, 'none'))} />
            {people.map(person => <CheckOption key={person.id} name={person.name} checked={state.filters.assignees.includes(person.id)}
              onChange={() => filter('assignees', toggle(state.filters.assignees, person.id))} />)}
          </FilterGroup>
          <FilterGroup title="Meilenstein" count={state.filters.milestones.length}>
            <CheckOption name="Kein Meilenstein" checked={state.filters.milestones.includes('none')}
              onChange={() => filter('milestones', toggle(state.filters.milestones, 'none'))} />
            {milestones.map(milestone => <CheckOption key={milestone.id} name={milestone.title} checked={state.filters.milestones.includes(milestone.id)}
              onChange={() => filter('milestones', toggle(state.filters.milestones, milestone.id))} />)}
          </FilterGroup>
          <FilterGroup title="Beziehungstyp" count={state.filters.relations.length}>
            {(['relates_to', 'blocks', 'parent', 'duplicate'] as const).map(kind => <CheckOption key={kind} name={relationNames[kind]}
              checked={state.filters.relations.includes(kind)} onChange={() => filter('relations', state.filters.relations.includes(kind)
                ? state.filters.relations.filter(item => item !== kind) : [...state.filters.relations, kind])} />)}
          </FilterGroup>
        </div>
        <label className="context-option"><input type="checkbox" checked={state.filters.context}
          onChange={event => filter('context', event.target.checked)} />Direkte Nachbarn als Kontext</label>
        <div className="results-heading"><h2><List size={15} />Ergebnisse <span className="count">{results.length}</span></h2>
          <button className="icon-button" aria-label={listOpen ? 'Ergebnisliste einklappen' : 'Ergebnisliste aufklappen'} onClick={() => setListOpen(!listOpen)}>
            {listOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></div>
        {listOpen && <ul className="results-list" aria-label="Tickets">
          {results.map(issue => <li key={issue.id}><button className={state.selected === issue.iid ? 'selected' : ''}
            aria-current={state.selected === issue.iid ? 'true' : undefined} onClick={() => selectResult(issue)}>
            <span className="result-meta"><span>#{issue.iid}</span><span><span className="status-dot" style={{ background: issue.status?.color ?? '#808080' }} />{issue.status?.name ?? issue.state}</span></span>
            <span className="result-title">{issue.title}</span>
          </button></li>)}
          {!results.length && <li className="empty-results">{busy && !workspace ? 'Tickets werden geladen …' : 'Keine passenden Tickets. Filter ändern oder zurücksetzen.'}</li>}
        </ul>}
      </aside>
      <section className="graph-workspace" aria-label="Ticketübersicht">
        <div className="graph-toolbar"><button className="mobile-filter" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}><Filter size={16} />Filter</button>
          <div className="segmented" aria-label="Ansicht">
            {(['network', 'themes', 'hierarchy'] as const).map((view, index) => {
              const Icon = [Network, Layers, GitBranch][index];
              return <button key={view} aria-pressed={state.view === view} onClick={() => setState(current => ({ ...current, view }))}>
                <Icon size={15} />{stateNames[view]}</button>;
            })}
          </div>
          <div className="readability-switch segmented" aria-label="Kartengröße">
            <button aria-pressed={!state.overview} onClick={() => { setState(current => ({ ...current, overview: false })); graph.current?.readable(); }}><Type size={15} />Lesbar</button>
            <button aria-pressed={state.overview} onClick={() => { setState(current => ({ ...current, overview: true })); graph.current?.fit(); }}><Maximize size={15} />Übersicht</button>
          </div>
          <button className={`connect-button ${connecting ? 'active' : ''}`} aria-pressed={connecting}
            disabled={!workspace?.issues.some(issue => issue.canLink)} onClick={() => connecting ? cancelConnection() : beginConnection()}>
            <Link2 size={16} />Verbinden</button>
          <span className="graph-count">{visible?.nodes.length ?? 0} Tickets{state.view !== 'themes' || state.theme ? ` · ${visible?.relations.length ?? 0} Beziehungen` : ''}</span>
          <button className="icon-button" aria-label="Graph neu anordnen" onClick={() => graph.current?.layout()}><RotateCcw size={16} /></button>
        </div>
        {connecting && <div className="connection-banner" role="status"><Link2 size={18} />
          <span>{connectionSource ? <><strong>Ausgangsticket #{connectionSource} gewählt.</strong> Zielticket antippen oder eine Verbindung ziehen.</>
            : <><strong>Welche Tickets gehören zusammen?</strong> Zwei Karten nacheinander antippen oder eine Verbindung ziehen.</>}</span>
          {connectionSource && <button onClick={() => setConnectionPair({ source: connectionSource, target: '' })}><Search size={15} />Ziel suchen</button>}
          {connectionSource && <button onClick={() => graph.current?.createChild(connectionSource)}><Plus size={15} />Neue Karte</button>}
          <button className="icon-button" aria-label="Verbinden beenden" onClick={cancelConnection}><X size={18} /></button></div>}
        {actionNotice && <div className="action-notice" role="status">{actionNotice}<button className="icon-button" aria-label="Hinweis schließen" onClick={() => setActionNotice('')}><X size={16} /></button></div>}
        {state.view === 'themes' && state.theme && <div className="theme-breadcrumb"><button onClick={() => setState(current => ({ ...current, theme: '' }))}>
          <ArrowLeft size={14} />Alle Themen</button><span>/</span><strong>{activeTheme?.name ?? 'Label nicht mehr verfügbar'}</strong></div>}
        <div className="graph-area">
          {workspace && <Graph ref={graph} workspace={workspace} matched={matched} state={state} select={select}
            connecting={connecting} connectionSource={connectionSource}
            create={createFromCard} labels={editCardLabels} start={beginConnection} placement={placement}
            focusRequest={focusRequest}
            connect={(source, target) => { if (source !== target) { setConnectionSource(source); setConnectionPair({ source, target }); } }}
            theme={theme => setState(current => ({ ...current, theme }))} />}
          {!workspace && <div className="graph-placeholder"><Network size={36} /><h3>{error ? 'GitLab ist gerade nicht erreichbar' : 'Deine Ticket-Landkarte entsteht'}</h3>
            <p>{error ? 'GitLab CLI und Verbindung prüfen. Danach erneut laden.' : 'Tickets, Status und Verknüpfungen werden geladen.'}</p>
            {!error && <div className="loading-line" />}</div>}
          {workspace && (!visible?.nodes.length || noThemes) && <div className="graph-placeholder"><Search size={30} /><h3>{noThemes ? 'Keine Themenlabels in dieser Auswahl' : 'Keine Tickets in dieser Ansicht'}</h3>
            <p>Filter zurücksetzen oder eine andere Ansicht wählen.</p>
            <button onClick={() => setState(current => ({ ...current, theme: '', collapsed: [], filters: emptyFilters() }))}>Auswahl zurücksetzen</button></div>}
          <div className="graph-tools"><button aria-label="Vergrößern" onClick={() => graph.current?.zoom(1.25)}><Plus size={17} /></button>
            <button aria-label="Verkleinern" onClick={() => graph.current?.zoom(0.8)}><Minus size={17} /></button>
            <span /><button aria-label="Alles einpassen" onClick={() => { setState(current => ({ ...current, overview: true })); graph.current?.fit(); }}><Maximize size={17} /></button>
            <button aria-label="Auf Auswahl fokussieren" disabled={!selected} onClick={() => selected && graph.current?.focus(selected.id)}><Focus size={17} /></button></div>
          {state.view === 'hierarchy' && hasChildren && selected && <div className="hierarchy-action">
            <button onClick={() => setState(current => ({ ...current, collapsed: toggle(current.collapsed, selected.id) }))}>
              {state.collapsed.includes(selected.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              Untertickets {state.collapsed.includes(selected.id) ? 'aufklappen' : 'einklappen'}</button>
          </div>}
        </div>
        <footer className="graph-footer"><GraphLegend />
          <span className="graph-hint">{state.view === 'themes' && !state.theme ? 'Thema auswählen, um Tickets zu sehen' : 'Rechts ziehen: verschieben · Links: interagieren · Touch: schieben & zoomen'}</span></footer>
      </section>
      {state.selected && workspace ? <Editor key={state.selected} iid={state.selected} workspace={workspace} close={() => select('')}
        select={select} dirty={markDirty} saved={saved} connect={beginConnection} /> : null}
    </main>
    {connectionPair && workspace && <ConnectionDialog workspace={workspace} initialSource={connectionPair.source}
      initialTarget={connectionPair.target} close={() => setConnectionPair(null)} saved={(snapshot, message) => {
        setWorkspace(snapshot); cancelConnection(); setActionNotice(message);
      }} />}
    {createRequest && workspace && <CreateCardDialog sourceIid={createRequest.source} workspace={workspace}
      close={() => setCreateRequest(null)} created={async result => {
        if (pendingRefresh.current) await pendingRefresh.current;
        if (createRequest.point) setPlacement({ iid: result.createdIid, point: createRequest.point }); setWorkspace(result.workspace);
        setState(current => ({ ...current, view: 'network', theme: '', filters: emptyFilters(), collapsed: [], selected: createRequest.source ? current.selected : result.createdIid }));
        setCreateRequest(null); setActionNotice(createRequest.source ? `Karte #${result.createdIid} wurde in GitLab erstellt und verbunden.` : `Ticket #${result.createdIid} wurde in GitLab erstellt.`);
      }} />}
    {labelIid && workspace && <QuickLabels iid={labelIid} workspace={workspace} close={() => setLabelIid('')}
      saved={async issue => { await saved(issue); setActionNotice(`Labels für #${issue.iid} in GitLab gespeichert.`); }} />}
  </div>;
}

function FilterGroup({ title, count, defaultOpen = false, children }: {
  title: string; count: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return <details className="filter-group" open={defaultOpen || undefined}>
    <summary>{title}<span>{count > 0 && <span className="count">{count}</span>}<ChevronDown size={14} /></span></summary>
    <div className="filter-options">{children}</div>
  </details>;
}
function CheckOption({ name, checked, onChange, color, count }: {
  name: string; checked: boolean; onChange: () => void; color?: string; count?: number;
}) {
  return <label className="check-option"><input type="checkbox" checked={checked} onChange={onChange} />
    {color && <span className="label-dot" style={{ background: color }} />}<span className="option-name">{name}</span>
    {count !== undefined && <span className="option-count">{count}</span>}</label>;
}
