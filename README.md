# TicketMap

A local visual workspace for a GitLab project that you configure. Explore tickets, labels, dependencies,
and parent-child relationships. Edit a ticket without leaving the graph. The repository contains no deployment target.

## Run

Requirements: Node.js 24 or later, npm, Git, and [GitLab CLI](https://docs.gitlab.com/cli/).
The GitLab CLI account needs access to your configured project. GitLab decides which edits that account can make.

Copy the source repository's clone URL from GitHub and replace `<repository-url>` below.
For an existing checkout, start with the `cd` command.

```powershell
git clone <repository-url> TicketMap
cd TicketMap
npm ci
```

Create a local `.env` from `.env.example` if it does not exist. Keep an existing `.env`:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

Set `GITLAB_URL` and `GITLAB_PROJECT` in `.env`. Replace the example values with your target:

```dotenv
GITLAB_URL=https://gitlab.example.com
GITLAB_PROJECT=example/team-project
```

`GITLAB_URL` must be an HTTPS origin. A port is allowed. Do not include credentials, a URL path, a query, or a fragment.
`GITLAB_PROJECT` is the full namespace and project path. Subgroups are supported, for example
`example/subgroup/team-project`. Missing or invalid settings stop startup. No project is selected automatically.
The server loads `.env` at startup. Existing process environment variables take precedence over the file.
Restart the server and reload open browser tabs after changing the target. No frontend rebuild is needed.
Write requests carry the target from the loaded workspace. The server rejects writes from a tab that still has the old
target. A target change does not apply an old draft to the new project.

Authenticate GitLab CLI for the hostname from `GITLAB_URL`, including its port if present. The commands below use the
example hostname; replace it with your configured hostname. Check an existing login before creating another one:

```powershell
glab auth status --hostname gitlab.example.com
```

If the existing login is missing or unsuitable, authenticate through the interactive CLI flow:

```powershell
glab auth login --hostname gitlab.example.com
```

Then build and start the application:

```powershell
npm run build
npm start
```

Run `glab auth login` only when the existing login is missing or unsuitable. CLI credentials stay in GitLab CLI's
credential storage. Do not put credentials in the source files or `.env.example`. The local `.env` is ignored by Git.
Use `git check-ignore .env` to confirm this before committing. Agent setup instructions are in [AGENTS.md](AGENTS.md).
If `glab` is not on PATH, run the auth commands through the executable from `GLAB_PATH` or the standard Windows path
`%LOCALAPPDATA%\Programs\glab\glab.exe`. A `GLAB_PATH` entry in `.env` is loaded by the application, not by your shell.

Open **http://127.0.0.1:4310** on the host. From another device on the same LAN, open
`http://<host-lan-ip>:4310`. The server binds to `0.0.0.0:4310` and prints its private IPv4 URLs at startup.
Host and origin checks accept localhost and the host's private IPv4 addresses detected at startup.
Restart the server after an address change. The firewall must allow inbound TCP port 4310 on the trusted private network.
No separate login is provided: LAN visitors use the host's GitLab CLI identity, including its ticket edit permissions.
Use an existing CLI login when one is already available. The application also finds the standard Windows installation
at `%LOCALAPPDATA%\Programs\glab\glab.exe`, even when that directory is absent from `PATH`.
For another location, set the optional `GLAB_PATH` environment variable or `.env` entry to the executable path.

For development, run `npm run dev` and open **http://127.0.0.1:5173**. This starts the API and Vite together.
Vite forwards `/api` requests to port 4310. Stop a running production instance before starting development.

## GitLab connection

The browser calls this application's local `/api` endpoints. The server uses shell-free `glab api graphql` processes
for GitLab reads and mutations. GraphQL request bodies travel through stdin. Image attachments use `glab api` for the
configured project's uploads endpoint. User text does not become a shell command.

The server applies one configured GitLab origin and project to all reads, writes, permission checks, and
image downloads.
The browser receives the target origin and project as workspace metadata. It uses them for the project header,
GitLab links, image recognition, and layout isolation. It receives no CLI token or credential file.
Callers cannot select another target through an API request. One server process serves one configured project;
there is no project picker.

The committed `.env.example` contains placeholders only. Keep real deployment values in the ignored `.env` or the
process environment. Keep GitLab credentials in the CLI's credential storage. Tests use synthetic targets and do not
need your local configuration or GitLab login.

## Use the workspace

- **Netz:** explore related tickets, directed blocking dependencies, and parent-child links.
- **Themen:** open a label cluster to see its tickets. A ticket can belong to more than one label cluster.
  Cluster membership does not imply a parent-child relationship.
- **Hierarchie:** explore real GitLab parent-child links. Select a parent, then collapse or expand its children.
  Tickets without a parent remain in the view.
- Search ticket numbers, titles, and descriptions. Combine status, label, assignee, milestone, and relationship filters.
  Values in one filter use OR; different filters use AND.
- Enable **Direkte Nachbarn als Kontext** to retain one hop of filtered neighbors. External references remain
  non-editable links to GitLab.
- Selecting a result by mouse or keyboard centers its card at a readable scale without moving any cards. Selecting
  the same result again brings it back after panning away. Collapsed ancestors open as needed; selecting a ticket in
  the theme overview opens the network map. On a phone, open **Filter** to access the result list.
- Opening a ticket in the inspector highlights that card, its directly connected visible neighbors, and their
  connecting edges.
  Other cards and edges are dimmed. Relationship colors and arrow directions remain unchanged. This uses the current
  filters and view; enable neighbor context to show filtered neighbors. Close the ticket or tap empty canvas to clear
  the selection. An unsaved draft still requires confirmation before it is discarded.
- Open **Legende** below the graph to see the actual line and arrow shapes with A/B examples for related, blocking,
  parent-child, and duplicate connections. It explains arrow direction and distinguishes edge color from card status.
- Nodes always include the ticket number, native status, title, and labels. The default **Lesbar** view starts at a
  readable scale around a connected group. **Übersicht** fits the full map; at that scale, text can become small but
  titles are never removed. Pan to explore, or use filters and focus to reduce the visible neighborhood.
- Filter, view, selection, theme, and collapsed hierarchy state stay in the URL. Refreshing the browser restores them.
- Dragged card positions stay in this browser after a GitLab refresh or page reload. Network, hierarchy, the theme
  overview, and each label theme have separate arrangements. Filters and collapsed groups retain hidden positions.
  New tickets appear beside a known neighbor or at the map edge without moving existing cards. **Graph neu anordnen**
  deliberately arranges the visible cards again and saves their new positions.

Arrangements use versioned `localStorage` for each GitLab origin, project, and view. Only node IDs and coordinates are
stored; ticket content and credentials are excluded. Arrangements are local to a browser profile and origin
(scheme, host, and port).
Another device, browser, or host address has its own map. Clearing browser data removes the arrangement.
If storage is disabled or full, a visible notice explains that positions last only until reload. Unreadable stored
positions produce a notice and a fresh arrangement. Zoom and pan are not saved.

Every readable card has a connection port, colored label markers, and open/label quick actions. At zoom below 0.5,
actions are hidden to prevent overlapping targets. Clipped actions are hidden and removed from keyboard focus.
Quick label editing reads the current ticket and sends only version-checked label additions/removals.
The card footer shows the first assignee's name and a count for additional assignees, or **Nicht zugewiesen**.
Long names use an ellipsis. The accessible description and the open action's tooltip include all assignee names.
This uses the existing GitLab data;
it does not load remote avatars. Assignment changes appear on refresh without moving the card.

Select a ticket to edit its title, Markdown description, existing labels, or native status. Choose **In GitLab speichern**
to send the changes. **Verwerfen** restores the loaded version. The application asks before discarding an unsaved draft
when switching or closing a ticket. It also requests the browser's standard leave-page protection for unsaved edits.

The Markdown preview disables raw HTML. GitLab image attachments load when they enter the inspector's visible scroll area.
Images stay within the panel width and show a GitLab link if loading fails. External images require **Externes Bild laden**
before the browser contacts their server. They use no referrer. Links remain available.
Assignees, milestones, and existing relationship types are read-only. New related/blocking/duplicate connections are supported.

## Connect tickets

Drag directly from a card's round connection port. Releasing over another card opens the relationship dialog.
Releasing over blank canvas opens the creation form. Releasing over the source, an external reference, or outside
the canvas does not create a ticket. These gestures do not write anything until a form is confirmed.

Alternatively, choose **Verbinden**, then tap two cards in order or drag from the source card to the target card. On a touch device,
the two-tap flow avoids precise dragging. Use **Ziel suchen** to select an offscreen ticket by number or title.
The result list provides the same selection with a keyboard. A ticket inspector also offers **Ticket verbinden**.

The dialog shows both full titles and offers four actions:

- **Verwandt:** create an undirected related link.
- **Blockiert:** the source blocks the target.
- **Wird blockiert durch:** the target blocks the source.
- **Duplikat von:** close the source as a duplicate of the target. This requires an explicit checkbox confirmation.

The direction switch swaps source and target before saving. Both tickets are read again and permission/version checks
run before the write. The server rejects self-links, unavailable or foreign tickets, existing links, and stale versions.
Related and blocking links use `workItemAddLinkedItems`. Duplicate actions use GitLab's documented `/duplicate #<iid>`
quick action through `createNote`; this closes the source and links it to the original.
The refreshed graph must confirm the requested direction or duplicate link and closed state before success is shown.
Neither action is retried automatically. Failed or unverified writes require loading the current GitLab state before retry.
Hierarchy editing, existing-link changes, and link deletion remain out of scope.

## Create a ticket

Choose **Neues Ticket** in the header. Enter a title, Markdown description, and existing labels. Submit with
**Ticket in GitLab erstellen**. This creates an independent Issue in the configured project. No existing ticket or
relationship is required. GitLab creation rights are checked before submission and again before the write.
After verification, the app opens the new ticket in the network view and clears filters. Existing card positions stay
unchanged. Canceling sends no write. An uncertain result locks submission and preserves the form for checking GitLab.
The same operation replay guard applies to independent and connected creation.

## Create a connected card

The drop-to-create dialog asks for title, description, existing labels, and connection kind. Its default is a real
GitLab **Task** under the source **Issue**. Other choices create an **Issue** with a related or directed blocking link.
Available types and creation rights come from GitLab. A Task cannot have another Task as a child; for an unsupported
source the dialog explains the limit and offers a related Issue instead. For touch or keyboard input, activate a card's
port and choose **Neue Karte** instead of dragging precisely.

Creation uses one `workItemCreate` mutation with `hierarchyWidget` or `linkedItemsWidget`. The source version,
permissions, project-owned type IDs, and label IDs are checked before sending it. The new ticket and expected link
must be present in the refreshed workspace before success is shown. A new card appears at the drop point, and this
position is saved. Filters clear and the view returns to the network. Known cards retain their network coordinates;
previously unseen cards receive free positions without rearranging the rest of the map.

Creation requests carry a UUID generated with `crypto.getRandomValues`, which also works on HTTP LAN origins.
The server retains up to 100 operation results for one hour. Identical requests with the same operation ID share
the original result; changed input with that ID is rejected. This in-memory replay guard is not durable GitLab
idempotency: a server restart or expired operation loses the receipt. The UI never retries creation automatically.
On an uncertain result it preserves the form, locks another write, and asks the user to check GitLab first. If the new
ticket number is known, the error identifies it and asks the user not to recreate it.

Touch controls use at least 44-pixel action targets and 16-pixel input text. The graph handles pan and pinch gestures;
touch users pan the canvas instead of moving ticket positions. Hover styling is limited to devices with a fine hover pointer.
On desktop, drag empty canvas with the left mouse button to select ticket cards with a rectangle. Hold **Ctrl** while
dragging to add cards, or **Ctrl-click** a ticket to add or remove it. Drag any selected card to move the selected group
together. Relative spacing stays unchanged, and the new coordinates are saved when the drag ends.
Group selection is temporary and does not change the inspector or write to GitLab. A normal card click still opens one
ticket with the existing draft protection. Click empty canvas or choose **Auswahl aufheben** to clear the group.
**Esc** also clears the group outside text fields and dialogs. View, filter, hierarchy-collapse, and connection-mode
changes clear the group; a data refresh retains it. The group itself is not restored after a page reload.
Hold the right mouse button to pan, including when starting over a card. Connection mode retains left-button drawing.
The graph suppresses the browser context menu for right-button navigation. Mouse wheel zoom uses Cytoscape's native
device normalization with sensitivity 6. A standard wheel step zooms about 18% after device detection; the first four
steps zoom about 32%. Line-based browser wheel events are converted at 16 pixels per line before device detection.
The point under the pointer stays in place. Wheel zoom does not move cards.
Safe-area padding and dynamic viewport height keep the inspector and dialog within the available screen.
Browser tests cover touch input emulation; Safari/Android behavior on physical devices still needs a device check.

## Data and update behavior

GitLab is the source of truth. There is no database, exported ticket file, browser credential store, or persisted draft.
Snapshots remain in server and browser memory. Fonts, icons, JavaScript, and styles are served locally.

The API reads GitLab GraphQL through shell-free `glab api graphql` processes. Request bodies use stdin; user content
does not become a shell command. The browser never receives CLI credentials. All queries and mutations are bound to
the one configured project. The API rejects unknown hosts and origins, and requires an allowed browser origin for writes.

All root and nested connections are paginated. Relationships are deduplicated by link ID. `is_blocked_by` is normalized
so the arrow always runs from the blocker to the blocked ticket. Parent-child edges use a separate type.
Unavailable items are not made editable through an external reference.

Status names, IDs, colors, and categories come from GitLab lifecycles. This includes canceled and duplicate statuses.
Duplicate-of URLs produce a directed duplicate edge; issue/work-item URL aliases resolve to the same local ticket.
Legacy `state::…` labels do not determine status and are not changed automatically. Native GitLab status transitions
control the open/closed state.

The browser refreshes on startup, on request, and every 60 seconds while the page is visible. It also refreshes when the
page becomes visible again. The API shares in-flight reads and caches a successful snapshot for 30 seconds. Manual and
periodic refreshes bypass the cache. A failed refresh retains the previous view and shows an error. Refreshes do not
replace a ticket editor's draft.

Before saving, the server reads the ticket again and compares `updatedAt` with the editor's baseline. A conflict returns
the current ticket and preserves the draft. You can load the GitLab version or explicitly continue the draft against it.
Continuing applies only your changed fields and label additions/removals; untouched fields use the newer GitLab values.
This is a best-effort conflict check: the GitLab mutation does not provide an atomic version condition, so another writer
can still race the save. Changed fields use one `workItemUpdate` mutation; labels use add/remove deltas.

After a successful mutation, the API reloads the ticket and invalidates the workspace snapshot. If the reload fails,
the UI reports that the write was sent but could not be verified. Read the GitLab version before retrying that save.
Mutations are never retried automatically.

## Local API

Shared contracts are in `shared/types.ts`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/workspace` | Snapshot of tickets, labels, statuses, references, and typed edges |
| `GET /api/workspace?refresh=1` | Request a fresh snapshot |
| `GET /api/issues/:iid` | Fresh ticket details and edit permissions |
| `PATCH /api/issues/:iid` | Send a validated `IssuePatch` |
| `POST /api/issues/:iid/connections` | Create a related/blocking link or an explicitly confirmed duplicate action |
| `GET /api/issues/creation-options` | Available project Issue creation rights |
| `POST /api/issues` | Create an independent Issue with title, description, and existing labels |
| `GET /api/issues/:iid/creation-options` | Fresh source details and allowed Task/Issue creation choices |
| `POST /api/issues/:iid/children` | Create a connected Task or Issue after form confirmation |

A patch requires `expectedUpdatedAt`. Optional fields are `title`, `description`, `statusId`, `addLabelIds`, and
`removeLabelIds`. Label and status values use GitLab global IDs from the workspace response. The route accepts a
project-local numeric ticket number, not a caller-selected project or global work-item ID.
Errors return `{ message }`; conflicts return HTTP 409 with `{ message, current }`.
Connection requests use `targetIid`, `kind`, `expectedSourceUpdatedAt`, and `expectedTargetUpdatedAt`.
Kinds are `relates_to`, `blocks`, `is_blocked_by`, and `duplicate`. The duplicate kind also requires `confirmDuplicate: true`.
A successful connection response contains the refreshed `Workspace`. Versions are best-effort checks, not atomic locks.
Independent creation requires `operationId`, `title`, `description`, and `labelIds`. It does not accept source,
relationship, type, or project fields. Connected creation requires `operationId` (UUID), `expectedSourceUpdatedAt`, `title`, `description`, `labelIds`, and `kind`.
Kinds are `subtask`, `relates_to`, `blocks`, and `is_blocked_by`. The server chooses the allowed type and configured project.
Success returns `{ workspace, createdIid }`. The browser cannot supply arbitrary type or project IDs.

## Verify

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm audit
```

Unit and API tests cover pagination, status handling, label overlap, filtering, hierarchy, dependency direction,
conflicts, permissions, request validation, local origin checks, stale reads, and the shell-free CLI transport.
Browser tests use synthetic data and intercept every API request. They exercise graph selection, label clusters,
hierarchy collapse, URL restoration, edits, failures, draft protection, safe preview, keyboard selection, phone layout,
permanent titles, mouse-drawn links, touch target search, duplicate confirmation, and failure recovery.
They also cover card-port dragging, drop-to-create, cancel-without-write, drop placement, quick label changes and
conflicts, uncertain creation, and touch-sized ports. Creation API tests cover operation replay, type/label permissions,
native parent/link input, blocking direction, and post-write verification.
Layout checks cover mouse dragging, browser reload, refresh additions/removals, retained filtered positions,
separate view/theme arrangements, deliberate re-layout, saved drop placement, and malformed or unavailable storage.
They do not send changes to GitLab.
Image checks cover deferred offscreen requests, private attachment delivery, explicit external-image consent,
retained images during edits, linked images, failure recovery, and mobile sizing. Transport checks reject invalid
upload paths, non-image data, oversized downloads, and stalled requests.

For a read-only check against the running production server:

```powershell
npm run test:live
```

This check reads the live workspace, opens network/hierarchy/mobile views, checks browser errors, and blocks browser
write requests. Screenshots stay under the ignored `output/playwright/` directory. Treat those images as private
project data. Do not publish them.

## Boundaries

This version supports one shared GitLab identity and one configured project on a trusted LAN. It does not create labels,
change or delete existing relationships, move existing hierarchy items, maintain independent clusters, or provide team hosting.
Topic labels must already exist in GitLab.
There is no MCP server dependency, AI classification, webhook receiver, background sync service, or remote deployment.

The image API accepts only an upload secret and a filename. It downloads from the configured project's
[GitLab Markdown uploads API](https://docs.gitlab.com/api/project_markdown_uploads/), using the host's CLI login.
It cannot proxy caller-selected URLs or other projects. Credentials and upstream headers stay on the server.
Supported image signatures are PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, and SVG. Downloads have a 15 MB response limit
and a 45-second timeout. Responses disable caching and use a restrictive content security policy. Unsupported or
larger attachments remain available through the GitLab link. Raw HTML images stay disabled.

This repository owns the application source, tests, and documentation. Deployment configuration and runtime output
stay local.
