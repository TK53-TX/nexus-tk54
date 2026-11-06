# Prompt: AI Front Desk to ServiceNow briefing page

Use this prompt to regenerate or extend `ai-front-desk-servicenow.html`.

---

## Role and goal

Build a single self-contained HTML page that walks a senior leadership audience through how an employee chat request moves from an AI Front Desk to a ServiceNow Incident, and what the Front Desk shows during the Incident's whole life. ServiceNow works as it does today. The Front Desk is a user-friendly AI app that talks to ServiceNow only through its APIs. People present it live from a laptop or projector, and they also share it as a link that others open on phones and tablets.

## Audience and tone

- Primary readers: senior IT, security, and service-desk leaders. Secondary readers: architects who want the API detail.
- Write in plain, active, present-tense English, using second person where it fits. Keep sentences short. Use no em dashes, no exclamation marks, and no superlatives such as "zero" or "never" unless the design guarantees them.
- Label example payloads as examples. Redact every secret.

## Architecture to show

Show four stations on a request lane, with an authenticated response lane returning underneath:

1. Employee Front Desk: identity bound by corporate SSO (SAML 2.0), plain-text input.
2. AI Gateway and Security: PII masking, prompt-injection screening, secrets held in a vault, and credential injection on the server side only.
3. ServiceNow REST APIs: the Virtual Agent Bot Integration API (`POST /api/sn_va_as_service/bot/integration`), the Table API, and the Attachment API.
4. ServiceNow Platform Core: Flow Designer creates the Incident record.

Draw two trust zones, "Inside the company boundary" (stations 1 and 2) and "ServiceNow cloud" (stations 3 and 4).

## Accuracy rules (ServiceNow)

Verify each of these against the ServiceNow documentation for the target release before you change it:

- The Bot Integration API's direct reply is only a success or failure status. Show `200 OK` with `{"status": "success"}`, not `202`. The real answer goes later to the configured response endpoint (the callback).
- Request fields include `requestId`, `clientSessionId`, `botToBot`, `userId`, `emailId`, `timestamp`, `message { clientMessageId, text, typed }`, `clientVariables`, and an optional `action`. `action: "AGENT"` moves the conversation to Live Agent.
- Callback messages carry `requestId`, `clientSessionId`, `nowSessionId`, `completed`, and a `body` array of items such as `{ "uiType": "OutputText", "group": "DefaultText", "value": "..." }`.
- Authentication: show a Message Auth `token` header. Also show an OAuth Bearer token, labeled as needed only when the API requires authentication. Use `/oauth_token.do` for the client-credentials token request.
- Show a 401 body as `{"error": {"message": "User Not Authenticated", "detail": "Required to provide Auth information"}, "status": "failure"}`.
- De-duplication: ServiceNow does not de-duplicate on a client key. The flow must store the gateway `requestId` in the Incident `correlation_id` and check it before inserting.
- Incident example: impact 3 with urgency 2 gives priority 4 under the default matrix. State 1 means New.
- Security note: cite AppOmni's CVE-2025-12420 (BodySnatcher) finding about shared Message Auth tokens. Recommend a unique token for each provider, and patching.
- Cite prompt injection as LLM01 in the OWASP Top 10 for LLM Applications.

## Integration decisions (keep these)

- **Updates after creation:** a Flow Designer flow on Incident updates POSTs a thin event (IDs, `sys_mod_count`, changed field names, no comment text) to the gateway's `/sn/events` webhook with a shared secret. The gateway then reads the details. Polling every few minutes is the safety net. Show change events travelling the top lane in reverse, from Platform Core to the Gateway. The lower lane is only for Virtual Agent callbacks.
- **Identity:** the Bot Integration API uses the integration account (bot-to-bot). All reads and writes on the employee's own tickets (Table API, Attachment API) use the employee's OAuth token through SSO, so ServiceNow access rules apply and the history shows the employee. The only exception is a read-only service account that reads three fixed fields (number, short_description, state) of a parent major incident.
- **Echo suppression:** the gateway records the `sys_mod_count` its own writes return and ignores events for those versions. Out-of-order events are resolved by `sys_mod_count`.
- **Work notes** are never requested, shown, or given to the AI.
- **Notifications:** the Front Desk owns them (app and Teams). The matching ServiceNow caller emails are turned off for Front Desk tickets.
- **Scope:** status timeline, two-way comments, confirm or reopen, attachments, and AI summaries that are always shown next to the original wording. Service requests are detected and handed off to the catalog. No SLA countdowns are shown.

## Scenarios (each one a sequence of stages)

Group them in the chooser as "Creating a ticket" (1 to 5) and "After the ticket exists" (6 to 10).

1. **Happy path:** intake, gateway with OAuth, Bot API handoff, Incident created (201), callback on the response lane, ticket delivered.
2. **Token expiry:** intake, gateway with a cached token, Bot API returns 401 (error), gateway refreshes the token, retry with the same `requestId`, Incident, callback, delivered.
3. **Policy block:** intake with an injection attempt, gateway blocks it with 403 (error, stays inside the company boundary), safe reply returned to the employee.
4. **Agent handoff:** intake ("I need a person"), the same gateway checks, Bot API with `action: AGENT`, chat routed to the assignment group's queue (status QUEUED, internal step, record fields marked illustrative), agent reply through the callback with `completed: false`, employee chatting with a person.
5. **Outage:** intake, gateway, Bot API returns 503 (error), request held in a retry queue with exponential backoff (QUEUED), honest status message to the employee.
6. **Agent asks a question:** the agent sets On Hold, Awaiting Caller (`state` 3, `hold_reason` 1) and adds an Additional comment; the flow sends an event; the gateway GETs the Incident as the employee (`sysparm_fields` without `work_notes`); the Front Desk shows "Waiting for you" with the agent's exact words plus an AI summary and one notification; the employee replies with a screenshot; the file goes up through `POST /api/now/attachment/file` (201); the reply goes in through `PATCH` to `comments`; the next events are an echo (ignored) and a state change back to In Progress.
7. **Fix rejected:** the agent resolves (`state` 6, `close_code`, `close_notes`); an event arrives; the Front Desk asks "Was this fixed?"; the employee says no, with a reason; a `PATCH` with `state` 2 plus a comment is sent as the employee (on a 403, fall back to a comment and an alert); ServiceNow increments `reopen_count` and notifies the agent; the employee sees "Reopened".
8. **Callback lost:** the create succeeds but no callback arrives within an example 20-second timer (TIMEOUT, error at the gateway); the gateway never resends the create, and instead GETs by `correlation_id`; the confirmation is delivered and operations is alerted.
9. **Duplicate report:** the next day the employee describes the same problem; the gateway lists their active Incidents as the employee; the AI suggests the match (MATCH) and never merges on its own; the employee chooses "Add to INC…"; a `PATCH` adds the comment; a confirmation follows.
10. **Major outage:** `parent_incident` is set by the major incident team; an event arrives; the parent's three approved fields are read with the restricted account; the Front Desk shows a known-issue banner; when the parent resolves, children are resolved by the instance's rules; the banner clears and the employee is asked to confirm.

For every stage, also provide what the employee sees in the Front Desk: new messages (user, assistant, agent with name, or system line), a typing line, the ticket card (number, plain-language status, team), a banner, and the choices offered. Accumulate this across the scenario's stages, starting from the scenario's existing conversation history. Map states to plain language, such as "Received", "In progress", "Waiting for you", "Resolved, please confirm", "Reopened", and "Linked to known issue". Agent messages show the original wording with an "AI summary" under it.

For every stage, provide: a short label, where it happens, a title, a 2 to 3 sentence summary, three "why it matters" points, a one-line outcome, three speaker-note lines, the API contract (route, method, endpoint, headers, status, meaning, three technical notes), and request and response JSON.

## Page behavior

- **Animated stage:** a capsule travels along the lanes with a trailing comet, stations light up as it arrives, and a status badge appears on arrival. Error stages turn the station red.
- **Transport bar:** Back, Play, Pause, Next, a clickable stage timeline, speeds 0.5x, 1x and 2x, Notes, and Fullscreen. Fullscreen must fail gracefully. Autoplay stops at the last stage instead of looping.
- **Inspector:** a narrative panel, an API contract panel, and a panel with three tabs: Employee view (the default), Request, and Response (JSON with syntax highlighting). Pin the ticket card in the Employee view and let only the messages scroll.
- **Executive view:** hides the API detail and shows the narrative, the "why it matters" list, and the Employee view side by side.
- **Scenario chooser:** a header button that shows the current scenario and opens the grouped scenario cards. Use `[` and `]` to move to the previous or next scenario.
- **Speaker notes:** a panel that replaces the API detail on desktop and appears below the narrative on small screens. It shows a "Next" preview and a "Copy full script" button. When the browser blocks the clipboard, the button opens a selectable text box instead.
- **Start screen:** scenario cards plus a keyboard shortcut list. It shows on first load when the link has no stage in it.
- **Briefing summary:** scenario cards, a "Measures to track" table (time to ticket number, self-service intake rate, duplicate ticket rate, blocked policy violations, escalation rate), security decisions, and source links. Baseline and target values come from a CONFIG object and show "Not set" when empty. Never invent figures.
- **Deep links:** use plain hashes only, such as `#happy-3`, `#recovery-1`, and `#summary`.
- **Keyboard shortcuts:** Space, Left and Right arrows, N, E, S, F, ?, and 1, 2, 3. Ignore them while an overlay or a text field has focus, or when a modifier key is held.

## Layout and responsiveness

- Width at least 1100px and height at least 620px: a fixed 1600x900 deck, scaled to fit, with a horizontal stage.
- Below that: a scrolling layout with a vertical stage. From 760px up, place the stage in a sticky left column with the inspector beside it. Below 760px, stack everything in one column.
- Never scroll horizontally. Keep a side gutter of at least 16px, using `max(16px, env(safe-area-inset-*))`. Touch targets are at least 44px on coarse pointers.

## Accessibility

- A polite live region announces a stage only when someone changes it or playback is paused. It stays silent during autoplay.
- Request/Response is a real tablist: arrow keys, Home and End, roving tabindex, and `aria-controls`.
- Overlays are modal dialogs: focus trap, Escape closes them, and focus returns to where it was.
- Under `prefers-reduced-motion`, the page doesn't autoplay, travel jumps to the end state, and ambient animations stop.
- Timeline buttons carry full-stage `aria-label`s and `aria-current="step"`.

## Visual design

- A deliberately dark-only identity. Tokens: navy `#07111E`, slate `#1E3A5F`, cobalt `#1A73E8` and `#3D8BFF`, soft blue `#8AB4F8`, alert `#FF5C6C`. Set `color-scheme: dark`.
- System font stacks for UI text and a monospace stack for code. Blue means request and success, pale blue means response, red means error.

## Constraints

- One HTML file with inline CSS and JS. No external requests except outbound links.
- No `alert`, `confirm`, `prompt`, or `window.print`.
- Keep all names, hosts, and IDs in a single CONFIG block.

## Quality gate before delivery

- No console errors at 1600x900, 1280x720, 1100x640, 820x1180 and 390x844.
- Zero horizontal overflow at every one of those sizes.
- All 62 stages across the 10 scenarios render, and the Employee view is correct at each one. Deep links, the summary, notes, the executive view, tab keyboard support and reduced motion all work.
- List any ServiceNow claim you could not verify, and mark it as unverified in the delivery note.
