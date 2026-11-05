---
colors:
  primary: "#244b3c"
  surface: "#ffffff"
  canvas: "#f7f8fa"
  background: "#f4f5f7"
  foreground: "#28332e"
  muted: "#66716d"
  line: "#dfe3e4"
  selection: "#edf2e9"
  relation-duplicate: "#885c9b"
typography:
  body:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 400
  title:
    fontFamily: "IBM Plex Sans"
    fontSize: "23px"
    fontWeight: 500
  graph-card:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "1.45"
rounded:
  control: "6px"
  workspace: "10px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "6px 11px"
  button-icon:
    textColor: "#59665f"
    rounded: "5px"
    padding: "4px"
    width: "30px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "5px"
    padding: "8px 10px"
  view-switch:
    backgroundColor: "#f0f2ef"
    rounded: "7px"
    padding: "3px"
  label-choice:
    textColor: "#65715f"
    rounded: "4px"
    padding: "5px 7px"
  ticket-result:
    textColor: "{colors.foreground}"
    rounded: "5px"
    padding: "10px 8px"
  graph-controls:
    backgroundColor: "{colors.surface}"
    rounded: "7px"
    padding: "4px"
---

# Ticket Map interface

## Overview

A restrained, light workspace for continuous project work. Use a forest-green action accent, neutral panels,
and native GitLab status colors. The graph is the working surface, not a decorative illustration.

## Colors

Use CSS custom properties in `src/styles.css` as the implementation source. Status and label colors come from
GitLab; always pair them with text. Red-brown edges mean blocking dependencies. Blue dashed edges mean hierarchy.

## Typography

Use locally served IBM Plex Sans for the application. Use tabular numerals for counts and timestamps. Use monospace
only for Markdown source and code blocks. Graph labels use IBM Plex Sans with a generic sans-serif fallback.

## Layout

Desktop uses a filter/result sidebar and a flexible graph. The inspector adds a third column only when a ticket is open.
At intermediate widths the inspector
replaces the persistent sidebar. On phones, filters open over the graph and the inspector fills the workspace.
Keep scroll areas inside their panels. Keep save actions visible below the inspector content.

## Elevation & Depth

Separate panels with one-pixel borders and neutral surface colors. Only the temporary filter panel uses a shadow.
Do not add gradients, decorative motion, or floating metric cards.

## Shapes

Use six-pixel control corners and ten-pixel workspace corners. Graph nodes are rounded rectangles. Label and status
indicators are small circles. Render graph controls with Lucide icons and accessible text labels.

## Components

View switches are segmented buttons. Filters use native checkboxes and disclosure sections. Ticket results are
full-width buttons. The inspector uses native text controls and explicit save/discard actions. Raw Markdown HTML
remains disabled. GitLab image attachments load when visible in the inspector. Keep them within the panel width,
with asynchronous decoding, a loading or error message, useful alt text, and a GitLab fallback link. External images
require an explicit load action. Linked images keep their original link without nested controls.
Graph nodes are 284 by 224 model pixels and always include titles and labels.
The default readable zoom is 0.85; the explicit overview fits all nodes without substituting compact labels.
Selection emphasizes the active card, its direct visible neighbors, and incident edges. Dim unrelated graph elements
and their HTML controls together. Keep edge colors/directions and card status colors intact. Clearing selection
restores normal contrast; selection does not rearrange the graph.
Selecting a result centers that card at a readable scale after the inspector and map have resized. Focus only the
selected card, not distant neighbors. A repeated result selection refocuses it; canceled draft navigation and GitLab
refresh must not move the camera. Expand collapsed ancestors when needed. A ticket result in the theme overview opens
the network map. Card coordinates remain unchanged.
Pack disconnected components so isolated tickets do not form a single root row.
Save node coordinates in browser storage per configured GitLab origin, project, and graph view, with a separate
arrangement for each label theme. Do not mix layouts from different GitLab origins or projects.
Restore before saving any initial coordinates. Filtering, hierarchy collapse, and GitLab refresh must preserve known
positions. Place only unseen nodes near a known neighbor or at the map edge. The explicit layout action rearranges
visible nodes and saves its result. Show a persistent notice when browser storage fails or saved positions are unreadable.
HTML controls follow the graph camera: number/status at the top left, open/label actions at the top right, colored
label markers at the bottom, and a round output port centered on the right edge. The port stays at a stable physical
size while zooming. Hide actions below zoom 0.5 and when clipped; keep them out of keyboard focus then.
Show the configured project in the header. Build GitLab links and recognize private images from workspace target
metadata. Keep deployment-specific names and URLs out of the static interface and frontend build configuration.
Share the existing bottom metadata strip between assignment and label markers. Show a person icon and the first
assignee's name, with an additional-person count, or **Nicht zugewiesen**. Keep full names in the accessible label
and the existing open action's tooltip.
Truncate long names and label text without hiding their indicators or counts. Do not change card dimensions or
load remote avatars. Assignment updates must preserve card coordinates.
Drop on a card to choose its relationship; drop on blank canvas to create a connected card, defaulting to a Task.
Keep a visible **Neues Ticket** primary action in the header, including on phones. It opens the existing creation
dialog without a source or relationship selector. Keep submission disabled while permissions load or creation completes.
The creation form and quick label dialog use the same native dialog, explicit-save, and draft-protection conventions.
The graph footer has an accessible legend disclosure. Show each actual line/arrow style between example cards A and B,
with a plain-language direction explanation. Keep the panel scrollable on phones and support Escape to close it.

Connection mode supports two-tap selection, drawing, and target search. Source and target receive the same restrained
green selection treatment. The native dialog explains direction and requires a separate checkbox before closing
a duplicate. Purple dotted arrows point from a duplicate to its original. Never report a write as successful before
the GitLab result is read back and verified.

On coarse-pointer devices, controls have a minimum 44-pixel target, inputs use at least 16-pixel text, and hover styles
do not persist after tapping. Keep browser page zoom available; reserve canvas gestures for graph pan and pinch.
For a mouse, reserve right-button dragging for camera panning and left-button input for card interaction and connections.
Keep native one-finger pan and pinch on touch input, including hybrid touch/mouse devices.
Use Cytoscape wheel sensitivity 6 with native device normalization for a direct response to each wheel step.
Convert line-mode wheel events to pixel deltas before Cytoscape handles them; keep pixel and touch input native.
Keep wheel zoom anchored at the pointer and retain
card coordinates and the existing zoom limits; do not add easing or delay.
Apply safe-area padding and contain overscroll within each panel. Test real-device behavior separately from emulation.

## Do's and Don'ts

- Keep the viewport stable when selecting a ticket or changing its text.
- Restore each view's saved arrangement. Move known cards only by dragging or the explicit layout action.
- Retain visible errors and unsaved text until the user resolves them.
- Do not imply that a label cluster is a GitLab parent-child structure.
- Do not use color alone to express status or make canvas interaction the only navigation path.
