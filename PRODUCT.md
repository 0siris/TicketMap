# GitLab Ticket Map

## Platform and users

A local web application for a developer or project planner who works on a configured GitLab project.
The user needs to understand relationships and change a ticket without navigating between board columns and pages.

The operator sets one GitLab origin and project through local configuration. No deployment target is part of the
application source. The same build works with another configured target after a server restart. GitLab CLI owns
the login.

## Product behavior

The workspace has filters and a keyboard-accessible result list on the left, a graph in the center, and a ticket
inspector on the right. Network, label-cluster, and real hierarchy views use the same GitLab data.
GitLab remains the source of truth. Titles, descriptions, existing labels, and native statuses are editable.
Ticket cards always show titles. Readable framing is the default, with an explicit full-map overview.
Card positions survive GitLab refresh and browser reload in the same browser and origin. Each configured GitLab origin,
project, graph view, and label theme has its own arrangement. Filters preserve hidden card positions. New tickets do not
rearrange known cards.
The explicit layout action saves a new arrangement for visible cards. Layout storage contains only IDs and coordinates,
with no shared or cross-device layout service. Storage failures show a notice and keep the current map usable.
Users connect tickets with two taps, mouse/touch dragging, or a target search. A dialog chooses related, blocking,
blocked-by, or duplicate semantics. A real duplicate action requires explicit confirmation before it closes the source.
Every readable card has a direct connection port, colored label markers, and open/label quick actions.
Dropping its port on blank canvas opens a connected-card form, defaulting to a native Task under an Issue.
The header **Neues Ticket** action creates an independent Issue with title, description, and existing labels.
It needs no source ticket. Verified creation opens the new ticket and preserves existing map positions.
Creation needs explicit form submission. Other relationship choices create a related or blocking Issue.
Ticket previews load private GitLab image attachments as they enter the visible inspector area. External images
require an explicit action before loading. Failed images keep an accessible description and a link to GitLab.

## Constraints

- Run on the host and its trusted LAN. Reuse the host's GitLab CLI login for all visitors.
- Keep real target configuration in the ignored `.env` or process environment. Commit only neutral example values.
- Keep credentials out of the browser. Keep private ticket data out of external services.
- Preserve drafts on request errors and conflict detection.
- Keep status distinct from legacy labels, and topic membership distinct from hierarchy.
- Support desktop graph work and phone access through the result list and full-width inspector.
- Do not add label creation, moves of existing hierarchy items, relationship deletion, or an independent planning database.
- Create and verify the new ticket and any requested relationship before reporting success. Do not retry uncertain writes.
- Check both tickets before a connection write and verify the resulting GitLab relationship before reporting success.
- Keep touch targets at least 44 pixels and provide a two-tap or search alternative to dragging.

## Interface mode

Operate. Prioritize legible state, stable navigation, explicit save feedback, and familiar controls.
UI text is German. Technical documentation and source comments are English.
