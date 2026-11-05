# TicketPortal Agent Guide

## Scope and purpose

These instructions apply to this repository. TicketPortal is a local web application for one configurable
GitLab project. Read [README.md](README.md) for setup and behavior, [PRODUCT.md](PRODUCT.md) for scope, and
[DESIGN.md](DESIGN.md) for UI rules.
Use English for source comments and technical documentation. UI text is German.

## Repository map

- `server/`: local API, validated GitLab configuration, shell-free GitLab CLI calls, and image downloads.
- `shared/`: browser/server contracts and pure helpers.
- `src/`: React UI, graph, inspector, and browser layout storage.
- `tests/`: synthetic fixtures, unit/API tests, and mocked browser tests.
- `scripts/smoke-live.mjs`: read-only check of the running local server.
- `.env.example`: neutral configuration template. The real `.env` is local and ignored.

## Set up a checkout

1. Confirm Node.js 24 or later, npm, Git, and GitLab CLI (`glab`) are available. Read `package.json` before
   running scripts.
2. Inspect existing process environment variables and a local `.env` for the target. Do not print secrets or the
   entire file. If `GITLAB_URL` or `GITLAB_PROJECT` is missing, obtain that value from the user. Do not infer a target from
   GitHub repository names, prior runs, test fixtures, or documentation examples.
3. Create `.env` from `.env.example` only when `.env` does not exist. Preserve existing settings. Put the actual target
   in `.env` or the process environment. Existing process environment variables take precedence over `.env`.
4. `GITLAB_URL` is an HTTPS origin, optionally with a port. It must not contain credentials, a path, a query,
   or a fragment.
   `GITLAB_PROJECT` is the full namespace/project path; subgroups are supported. Restart the server and reload browser
   tabs after a target change. The server rejects write requests from a tab that still uses the previous target.
5. Resolve `glab` from PATH, the local `GLAB_PATH` setting, or `%LOCALAPPDATA%\Programs\glab\glab.exe` on Windows.
   Use that executable for `auth status --hostname <configured-host>`, with the host and optional port
   from `GITLAB_URL`.
   If needed, use its interactive `auth login --hostname <configured-host>` flow. Replace the placeholder before running
   either command. Reuse a suitable existing login. Never request or paste a token in chat or source code.
6. Set `GLAB_PATH` locally only when the executable needs a custom location. The application loads `.env`;
   shell commands must use the resolved executable explicitly when it is not on PATH.
7. Run `npm ci`, then the build and tests below. Check `git check-ignore .env` before staging files.

Do not put actual project paths, server addresses, credentials, private ticket data, or local filesystem paths into
tracked configuration, fixtures, documentation, or frontend environment variables. Keep `.env.example` synthetic.
The source repository URL identifies this codebase; it is not the runtime GitLab target.

## Build, test, and run

Run these commands from the repository root:

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Unit/API tests and browser tests use synthetic targets. They must work without a local `.env`, GitLab login,
or live writes.
Install the Playwright browser when needed. Run checks serially when they share files or ports.

Use `npm start` after a build. The API and production UI use port 4310. Use `npm run dev` for the local API and Vite UI;
the development UI uses port 5173. Identify any process that owns a required port before starting another server.
Do not stop an unrelated process. The application uses the host's shared GitLab CLI identity on the trusted LAN.

With a configured server running, `npm run test:live` reads the workspace and blocks browser write requests.
Its screenshots contain private project data and stay in ignored `output/`. Mocked test success does not prove
live GitLab compatibility.
Do not create, edit, or close real tickets to test a change unless the user authorizes those writes.

## Implementation rules

- Read connected code and reuse its owners. Prefer small changes and existing dependencies.
- The server validates one target at startup. Pass that target to all GitLab reads, writes, and image downloads.
  Never accept a caller-selected project, hostname, or arbitrary download URL through the browser API.
- Keep GraphQL request bodies on stdin and CLI calls shell-free. Keep credentials and upstream headers on the server.
  Expose only public target metadata to the browser. Do not add `VITE_` credentials or deployment targets.
- Preserve local host/origin guards, write-origin checks, target-bound write headers, permission checks,
  conflict handling, and post-write verification. A stale browser target must never write into another configured project.
  Never retry an uncertain mutation automatically.
- Keep real GitLab status, labels, hierarchy, and relationship directions distinct. GitLab remains the source of truth.
- Preserve drafts and saved card coordinates. Keep layouts isolated by GitLab origin, project, view, and label theme.
  Do not clear browser storage or move known cards as a side effect of refresh, selection, or text changes.
- Keep raw Markdown HTML disabled, private uploads bound to the configured target, and external images opt-in.
- Do not manually edit `node_modules/`, `dist/`, `test-results/`, `playwright-report/`, or `output/`.

## Before handoff

Before each commit, verify the repository-local `user.name` and `user.email`. Use the owner's GitHub username and
GitHub-provided noreply address. Do not use a workplace name or email. Do not change global Git identity.

Run the checks that match the changed code. For UI changes, inspect desktop and mobile behavior. State what passed,
what was skipped, and why. Update the existing README, product, or design document when durable behavior changes.
Review `git status` and the staged file list. Keep local configuration, credentials, runtime output, screenshots,
and logs out of commits. Preserve existing Git history unless the user explicitly requests a history rewrite.
