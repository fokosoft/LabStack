# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file interactive educational web app: a bilingual (ES/EN) "visual infrastructure workshop." The learner drags infrastructure blocks (router, switch, hypervisor, Docker, Kubernetes, databases, cloud, etc.) from a palette into a layered stack, then runs an animated "flow" that traces a request through the assembled layers. It teaches the layers of a modern infra stack and why each one matters.

Almost all real content and behavior lives in [Laboratorio.dc.html](Laboratorio.dc.html). [support.js](support.js) is a build artifact, not source.

## Running

Open `Laboratorio.dc.html` in a browser. No build step, no server, **and no internet**.

Everything it needs is in the repo:

- `vendor/react*.js` — React 18.3.1 UMD. `support.js` still *names* the unpkg URL, but `cdnScriptFor()` looks the URL up in `window.__resources` first, and the `<script>` block in `<head>` maps both to `./vendor/`. Delete that block and it goes back to the CDN.
- `vendor/fuentes.css` + `vendor/fonts/` — Inter and JetBrains Mono, **latin subset only** (8 files, 328 KB). Latin-1 covers Spanish and English completely; the few symbols outside it (`←`, `→`, `★`, `✓`) already fell back to the system font before.
- `vendor/confetti.browser.js` — self-hosted, and this also **fixed a live bug**: the CDN URL in the code was `confetti.browser.min.js`, which does not exist in canvas-confetti 1.9.3. The confetti had never once fired.
- `contenido/*.js` — loaded with `<script src>`, never `fetch`, for the same reason.

Verified by rendering with every DNS lookup blackholed (`--host-resolver-rules="MAP * 0.0.0.0"`): the app boots, the fonts are right and there is not a single `ERR_` in the console. If you add a dependency, vendor it — do not reintroduce a CDN.

## The `.dc.html` "Design Component" format

This is a custom React-backed component format, not plain HTML. A `.dc.html` file has two parts inside `<x-dc>`:

1. **Template** — HTML with a mini templating dialect (compiled to `React.createElement` by the runtime).
2. **Logic** — `<script type="text/x-dc" data-dc-script>` defining `class Component extends DCLogic`.

### Template dialect (what to use inside `<x-dc>`)

- `{{ expr }}` — interpolation. Binds to whatever `renderVals()` returns, plus props. Also used for `onClick="{{ handler }}"`, `disabled="{{ bool }}"`, `style="...{{ val }}..."`, etc.
- `<sc-for list="{{ arr }}" as="item">…</sc-for>` — list rendering; `hint-placeholder-count` is a streaming hint only.
- `<sc-if value="{{ cond }}">…</sc-if>` — conditional rendering.
- `<helmet>…</helmet>` — content hoisted into `<head>` (fonts, `<style>`, CSS variables). The `:root` / `.theme-dark` CSS-variable palette lives here.
- `style-hover="…"` / `style-<pseudo>="…"` — pseudo-class styles compiled into a real stylesheet (plain inline `style` can't express `:hover`).
- Event attrs use HTML casing (`onClick`, `onDragStart`) and are mapped to React handlers.

### Logic contract (`class Component extends DCLogic`)

- `state = { … }` — component state; mutate only via `this.setState(patch)` or `this.setState(s => patch)`.
- `renderVals()` — **the key method.** Returns the flat object the template binds against (merged over props). This is where `state` + static data are transformed into everything the template reads: palette groups, stacked layers, flow captions, button styles, i18n strings, etc. To change what the UI shows, you almost always edit `renderVals()` and the template together.
- Methods are called directly from the template via `{{ }}` handlers (e.g. `onBlockClick`, `onLayerClick`, `runFlow`, `reset`, `loadPreset`).
- `DCLogic` is the base class exposed by the runtime (aliased `StreamableLogic`).

## Where the content lives

**The content is not in `Laboratorio.dc.html` any more.** ~139 KB of it sits in `contenido/*.js`, loaded by plain `<script src>` tags in `<head>` before `support.js`:

| File | Holds |
|---|---|
| `contenido/piezas.js` | `categorias`, `piezas` (the 75 technologies), `fichas` (one-liner / when to use / alternatives), `iconos`, `dimensionado` |
| `contenido/capas.js` | `capas` — per-layer pedagogy (hint, why, miss, anal, flow) |
| `contenido/textos.js` | `textos` — every UI string, `{ es, en }` |
| `contenido/retos.js` | `retos` (missions) and `incidentes` |
| `contenido/kids.js` | `kids` — the Kids steps |

**They are `.js`, not `.json`, and that is deliberate.** `fetch` of a sibling file is blocked by CORS under `file://`, and the app must keep opening with a double-click and no server. A classic `<script src>` has no such limit. Each file is still pure data — no logic — so a teacher edits content without opening the app code.

**Every entry is a function, not a value:** `window.LABSTACK.piezas = function () { … return [ … ]; }`. That is not decoration — `extras()`, `specs()` and `pieceIcons()` **mutate** what their `*Base()` returns to merge in the teacher content pack. Returning a shared singleton would let those mutations pile up across calls. A fresh object per call reproduces the original semantics exactly.

Splitting the content across files made a new class of bug possible — a Kids step naming a piece that no longer exists, a mission asking for an invented category, a string that is in Spanish but not English. None of it is caught by the smoke test, because the app still boots. **`node content-test.js`** checks exactly that: cross-file references, duplicate ids, every category with cost and pedagogy, Kids distractors never drawn from the answer's own layer, and ES/EN key parity. Run it after editing anything under `contenido/`.

Reading goes through `content(key, fallback)`, which calls `contentMissing(key)` and logs a clear one-time error if a file did not load, instead of rendering a blank app. **To add a piece or change a text, edit `contenido/` — not the logic.** The `contentPack` teacher mode (localStorage JSON) still layers on top of all this, unchanged.

### Data model (all defined as methods returning arrays/objects in the logic script)

- `cats()` / `blocks()` / `layerMeta()` / `strings()` / `missions()` / `incidents()` / `kidsSteps()` now read from `contenido/` (see above); the methods that remain in the file are thin readers.
- `cats()` — the 17 infrastructure categories (id, color, bilingual name). 10 are stackable layers; `seguridad`, `cicd`, `iac`, `monitorizacion`, `gobernanza`, `mensajeria`, `backup` are cross-cutting transversals (rendered separately, not in the stack).
- `blocks()` — the draggable items. Each block has `id`, `cat` (category id), `code` (badge), bilingual `name`/`why`/`desc`, `facts[]`, and optionally a fake `term[]` transcript or `steps[]`.
- `layerMeta()` — per-layer pedagogy (bilingual `hint`, `why`, `miss`, `anal`, `flow`), keyed by category id.
- `strings()` — UI chrome strings.
- The canonical stack order (bottom→top) is the `stackIds` array in `renderVals()`.

### i18n

Every user-facing string is `{ es: '…', en: '…' }`. `this.loc(obj)` returns the string for the current `state.lang` (`'es'` default). Never hard-code display text — always add both languages and go through `loc()`.

### Learning modes (`state.mode`)

The app has **ten** values of `state.mode`. Product-level status and roadmap live in [ROADMAP.md](ROADMAP.md).

The header does **not** expose ten peers. It exposes **three verb-based groups** (`navGroups` in `renderVals()`), and the modes inside a group are switched from a secondary chip row rendered at the top of the canvas (`subnav`):

| Group (header) | Modes | Where you switch |
|---|---|---|
| **Aprender / Learn** | `sandbox` | — |
| **Practicar / Practice** | `mission`, `quiz` | canvas `subnav` |
| **Explorar / Explore** | `map`, `http`, `deploy`, `metrics`, `terminal`, `incident` | canvas `subnav` |

`groupOf` maps mode → group. Clicking a group only switches mode when you are not already inside it, so the sub-view you picked is preserved.

- `'home'` — **the default and the single entrance.** Three cards (Aprender / Practicar / Explorar) built in `home.cards`, a "continue where you left off" strip when `placed` is non-empty, and content stats. Reached from the brand button (`goHome()`); `mode` is deliberately **not** persisted, so every session starts here. A stack shared by URL is the exception — it lands straight on `sandbox`.
- `'sandbox'` — the free-build lab. Shows the tree + example presets.
- `'mission'` — goal-based challenges from `missions()`. Each mission declares required categories (`need`), specific blocks (`needBlock`), optional `redundant` categories (need 2+ pieces), optional `budget`, and a `level` (1–3). `missionProgress()` / `checkMission()` evaluate the built stack live (goals + budget + zero linter errors) and give feedback. Presets are hidden here.
- `'quiz'` — retrieval-practice quiz, **adaptive** (`buildQuiz()` weights categories by past mistakes via `quizWeight`/`weightedPick`). State in `state.quiz`; per-category stats in `state.quizStats` (persisted). Result screen shows mastered vs to-review.
- `'map'` — pan/zoom physical map. `buildMap()` lays categories into physical zones; the world div is transformed via `translate()+scale()` (`state.map`). Node icons come from `pieceIcon()` (per-piece, falling back to category). Has animated request **flow** (`runMapFlow()`), dependency **curves** with animated traffic, linter **alerts** anchored to nodes, and a **chaos** mode (`toggleChaos`/`simulateFailure`/`resilience`/`cascadeFailure`). `effectivePlaced()` centralizes the real-or-demo `placed`.
- `'terminal'` — simulated shell (`execCmd()` + `cmdKubectl/cmdDocker/cmdGit/cmdTerraform` helpers). ~148 commands, stack-aware (each errors realistically if its layer isn't deployed). Virtual filesystem via `vfs()`/`vfsFiles()`/`resolvePath()`; state in `state.term` (`input`, `history`, `cmdHistory`, `histIdx`, `cwd`). History (↑/↓), Tab autocomplete (`termCmds`/`termComplete`), `man` (`manPage`).
- `'metrics'` — live dashboard. A `setInterval` (`tickMetrics`, started/stopped in `setMode`) pushes points into `state.metrics` series; `sparkPath()` builds SVG polylines. Load dial drives CPU/RAM/req-s/latency with alerts. SVG-native, no libraries.
- `'http'` — **request waterfall** (DevTools-Network style). `buildRequest(placed, failKey)` rolls per-hop latencies (jitter × load factor) from the built stack (or `effectivePlaced()` demo), deriving hops from present pieces (DNS/CDN/TLS/FW/LB/gateway/app/cache/DB/storage). `waterfallView()` formats bar geometry + status; tapping a hop toggles `state.reqFail` (simulated failure → realistic status code, downstream hops skipped); missing compute ⇒ implicit 502. `state.request`/`state.reqFail`; `runRequest()`/`toggleReqFail()`.
- `'deploy'` — **deployment simulator** (rolling / blue-green / canary). `deployFrames(strategy)` returns per-step frames (replica boxes by version, traffic split, downtime); `deployView()` formats them. Playback via `setInterval` (`deployPlay`, cleared in `setMode`); `deployNext/Prev/Reset/Rollback`; `state.deploy` (`strategy`,`step`,`playing`,`rolled`).
- `'incident'` — **troubleshooting runbook**. Scenarios in `incidents()` (symptom, `checks[]` diagnostic outputs with red herrings, multiple-choice `causes`/`fixes`, resolution + takeaway). Phase machine (`brief`→`investigate`→`diagnose`→`fix`→`done`) in `state.incident`; `incidentView()` builds the per-phase view; correct fix unlocks the `incident` achievement. Wrong guesses give feedback and let you retry.

**Cross-cutting features:** color families (`cats()` `fam` + `families()`), palette search/filter/collapse (`state.search`/`famFilter`/`collapsed`), sizing/budget (`specs()`/`sizing()`), persistence + shareable URL (`persist`/`loadLocal`/`shareLink`/`readUrlStack`, `componentDidMount`/`Update`), achievements (`achievements()`/`unlock()`/`evalAchievements`, `state.achievements`, confetti via CDN), guided tour (`tourList()`), print export (`.print-sheet` + `@media print`). Governance frameworks (COSO/ISO 27001/COBIT) are a transversal category `gobernanza`.

### Architecture rigor (dependency + linter engine)

Cutting across all modes: `deps()` declares category-level dependencies (`orquestacion`→`contenedores`→`so`→`computo`/etc, each as a `oneOf` list). `analyzeArch(placed)` runs it plus anti-pattern rules (single point of failure = no load balancer, data without persistence, unencrypted edge = no TLS, no firewall, no observability) and returns `{ errors, warns, oks, score, empty }` — `score` is a 0–100 robustness rating (`100 − errors·25 − warns·10`). It feeds two surfaces from one model: the right-panel **"Análisis de arquitectura"** card (shown in the guide slot when pieces exist; `analysis`/`analysisShow`/`analysisEmpty` in `renderVals`), and the map's **dependency links** (`buildMap()` draws lines between piece groups via `deps()` + `catPt`). The linter analyzes `state.placed` normally, or `effectivePlaced()` in map mode so the demo also gets analyzed.

`renderVals()` computes the per-mode view objects (`mission`, `quiz`, `map`, `analysis`, `sizing`, `metricsTiles`, `home`, terminal fields…) and exposes mode flags (`showTree`, `showQuiz`, `showMap`, `showTerminal`, `showMetrics`, `showMissionPicker`, `showMissionGoals`, `showPresets`, `showHome`). To add a mission, append to `missions()`; a quiz variant, extend `buildQuiz()`; a terminal command, add a `case` in `execCmd()` and to `termCmds()`; a piece, edit `blocks()` (+ `extras()`/`pieceIcons()`/`specs()`). There is a Node smoke-test pattern (instantiate `Component` with stubbed `DCLogic`/`React`/`localStorage`/`window`, call `renderVals()` across all ten modes; simulate events with stubbed `currentTarget.getBoundingClientRect`/`e.key`) used to validate logic changes without a browser — every feature above was verified this way. A companion check walks every `{{ key }}` in the template and asserts it has a binding in some mode; run it after touching the template.

### Kids mode (`mode === 'kids'`)

A fourth header group, built on **the opposite rules to the rest of the app**. Everything it shows is reused (`blocks()`, `catById` colours, the map's `artArchetypes()` drawings) but the presentation is driven by how children actually learn — treat these as constraints, not style preferences:

- **One decision per screen.** A child's working memory holds far less than an adult's, so: one layer, one question, **exactly three options**, never a palette. Don't add a fourth option.
- **Concrete before abstract.** Every layer enters through a real-world analogy written for the age (*"el switch es un cartero rapidísimo"*), never through its technical definition. `kidsSteps()` holds that copy — `title`, `say`, `ask`, `hint`, `why` — bilingual like everything else.
- **An error is information, never a failure.** A wrong tap has no penalty, no red, no score: the card turns warm, reveals what it actually is (*"eso es PostgreSQL, de Bases de datos"*) and gives a concrete visual hint. Nothing advances. Keep it that way.
- **The family label is a reward, not a prompt.** `layerShow` reveals a piece's category **only after** it is tapped — correct (labels it) or wrong (corrects it). Showing it up front removes the retrieval, which is where the learning is.
- **What you build never disappears.** The tower on the right grows bottom-up with a Scratch-style nub on each block and is still whole on the final screen.
- **The guide stays on screen** the whole game (`guideShow`), even after a correct answer. It is the child's anchor.

**Two separate games, not one long one.** `state.kids.part` (null = chooser, 1 = the tower, 2 = the helpers); `kidsPartSteps(part)` filters `kidsSteps()` by `chapter`. 17 steps in one sitting is past what this age sustains (~8 min), so each part stands alone and part 2 can be played another day. In part 2 the tower renders **complete and dimmed** as context, so the child sees what they are helping even with no memory of part 1 — progress is still not persisted on purpose.

**Two chapters, and the difference between them is the lesson.** Chapter 1 builds the tower (10 stack pieces, `side` falsy); chapter 2 adds the three that look after it (`side:true` — firewall, monitoring, backup). They render apart: tower blocks solid with a Scratch nub, guardians dashed under a separate heading — the same solid-vs-dashed language the adult app uses for stack vs. transversals. A child learns the shape of the idea without the word. `kidsView()` splits `built` into `tower` (reversed, bottom-up) and `guards`; the chapter banner shows only on the first step of each chapter.

Flow: `state.kids = { step, phase: 'ask' | 'ok' | 'end', wrong }`; `kidsPick()` → `kidsNext()` → `kidsRestart()`; `kidsView()` builds everything. Progress is **not** persisted — the run is short and a half-finished state would confuse more than it helps. The final screen offers a bridge into `map`, so a child who finishes can go look at the real thing.

Colour is deliberate: each option carries **its own family colour**. At step 1 that means nothing to the child; by step 5 the colour itself has become a cue. That is the intended effect — don't neutralise it.

### Events mode (`mode === 'events'`) — the OBM-style console

A live console of raw events plus the ITSM layer on the incident. The pair teaches the thing a monitoring tool cannot: **an event is not an incident.**

- `contenido/eventos.js` holds the events. Three kinds, and the distinction is the whole lesson:
  - `cause: true` + `related: [ids]` — the root cause, which rolls up its symptoms.
  - `symptomOf: id` — a consequence. Closing these one by one fixes nothing.
  - `noise: true` — informational. It can be acknowledged and closed but **never** raises an incident; `events-test.js` asserts that.
- Correlation must be **reciprocal**: a symptom naming its cause, and the cause listing that symptom. The test fails the build otherwise, because the indentation in the list would be lying.
- The list is **grouped, not just sorted**: each cause is followed by its own symptoms. Sorting by severity alone puts a symptom visually under the wrong cause.
- Acknowledging or closing a cause takes its symptoms with it (`evAckGroup`, `evCloseGroup`) — that is what makes triage feel like triage.
- `evRaise(id)` is the bridge: acknowledge the group, switch to `desk`, open the ticket the event points at, and write the origin event into the work log.

### ITSM layer on the incident

`itsmView(tk, d)` wraps the Puesto ticket in what a real service desk shows:

- **Priority is derived, never chosen.** `itsmMatrix()` maps the content's `prio` to impact × urgency; the product gives P1–P4 and the SLA target (1 h / 4 h / 8 h / 24 h). The panel shows the two inputs next to the result so the learner sees where "Crítica" actually comes from.
- **State machine** Nuevo → En curso → Resuelto → Cerrado, driven by `desk.phase`.
- **Work notes.** `deskLog()` records every real action: opening, the originating event, each command and the host it ran on, the hypothesis, the root cause and the fix. `deskState()` **must** return `log` — it did not at first, and every entry silently overwrote the last one.

### Desk mode (`mode === 'desk'`) — four sessions at once

A ticket queue plus **four simultaneous terminals**, one per host (`fw01`, `sw-core`, `web01`, `db01`, from `contenido/tickets.js`). The teaching point is not typing commands — the Terminal mode already does that — it is that **the same command answers differently depending on where you run it**, so you have to pick the right box.

- `state.desk.terms` is an array of independent sessions (`host`, `input`, `history`, `cwd`, `cmdHistory`). They never share history; `desk-test.js` asserts that.
- `execCmd(raw, sess)` gained an optional session (`{cwd, host}`). Same interpreter as Terminal mode, different working directory and hostname. Do not fork it.
- **Ticket evidence overrides the generic terminal.** `deskEvidence(host, raw)` looks up the open ticket's `evidence[]` for a `(host, command)` match and returns those lines instead. Anything not declared falls through to `execCmd` and answers as usual. That is what lets one command tell *this* ticket's story on the box that matters.
- Resolution reuses the incident pattern: investigate → cause → fix, wrong answers give feedback and never advance.

**Hosts come from the stack you built.** `deskHosts()` reads `effectivePlaced()` and, for each of the four roles (`red`, `seguridad`, `so`, `datos`), picks the first piece placed in that category: the host is renamed via `deskHostName()` (`winserver` → `win01`, `kong` → `gw01`, `redis` → `cache01`…) and labelled **from the category**, never from the sample host — put Vault where the sample had a firewall and it must not keep saying "firewall". A role you have not built keeps its sample host, visibly marked, so the desk is never a dead end.

This is why **ticket evidence binds to the role id, not the hostname**: `evidence[].host` is matched against `h.id` (the stable role key), while the prompt, the header and `hostname` show `h.name` (what you actually built). Renaming a host must never break a ticket — `desk-test.js` loads a preset and re-checks the evidence still lands.

Tab completion is `deskComplete(i)`, per session, sharing `termCmds()` with Terminal mode. `man` needs nothing special: it is a `case` in `execCmd`, so it already works.

`content-test.js` enforces the rules below — most importantly that **a ticket's evidence spans at least two hosts**. One host means the learner never has to choose where to look, which is the whole point of the mode; it caught three of the first five tickets failing exactly that.

**Command hints.** `contenido/comandos.js` maps a command prefix to one line of *what it tells you* — not what it does, what you learn from it. `cmdHint()` matches **longest prefix first**, so `systemctl status nginx` gets its own line instead of falling back to `systemctl status`. The suggestion list renders it under each command, so "type this" becomes "I am looking for this". Add a command to a ticket's `suggest` and give it an entry here — `desk-test.js` fails if any suggested command has no hint.

**The right command on the wrong host is a signpost, not a dead end.** `deskOtherHost()` checks whether the typed command has evidence on a *different* host of the open ticket and, if so, appends one dim line saying so. It deliberately **does not name the host** — choosing the box stays the exercise; the test asserts the line never leaks a hostname. A command that is evidence for nobody (`uptime`, `df -h`) must not trigger it.

**Every piece of evidence that shows a fault also carries `fixed`** — how that same command answers once the incident is resolved. `deskEvidence()` returns `fixed` when `phase === 'done'`. Without it the simulation contradicts itself: you apply the fix, re-run the check and it still reports the failure. Evidence that only ruled something out has **no** `fixed` — it was healthy before and stays healthy, and changing it would be a lie in the other direction. `content-test.js` fails any evidence with an `err` line and no `fixed`, and any `fixed` that still contains an `err` line; `desk-test.js` resolves all twelve tickets and re-runs every check.

**Writing a ticket** (`contenido/tickets.js`): give it evidence on **more than one host**, including at least one that rules something out — a firewall that turns out to be fine is as instructive as the broken thing. Keep the distinctive line long enough to be unique: `desk-test.js` matches on the longest line precisely because a short one like `4` collides with generic output.

### Map artwork (schematic illustrations)

Map nodes are **not** the small line icons used elsewhere. Each node draws a schematic front view of the real device, so a rack, a switch and a database are told apart without reading the label.

- `artArchetypes()` returns ~39 archetypes keyed by name (`rack`, `server`, `switch`, `router`, `patch`, `lb`, `globe`, `gateway`, `appliance`, `diskshelf`, `nasbox`, `raidset`, `bucket`, `tape`, `mirror`, `db`, `memory`, `search`, `container`, `cluster`, `vm`, `hostvms`, `os`, `winos`, `cloud`, `tunnel`, `cert`, `lock`, `idcard`, `screen`, `gauge`, `spans`, `doclines`, `bell`, `pipeline`, `branch`, `blueprint`, `queue`, `doc`). Each is a list of `[d, role]` pairs on a **56×46** canvas.
- **Everything is a `<path>`** — no `<rect>`/`<circle>` — so the template renders one `sc-for` over `n.art`. Use the `artBoxes()` / `artCircle()` helpers to generate repeated ports, bays and circles into a single `d`.
- Roles map to concrete paint in `paintArt(key, color)`: `body` (chassis: `var(--panel)` fill + accent outline), `panel` / `soft` (accent tints), `solid` (full accent: LEDs, flames, hubs), `line` (thin stroke). Because `body` fills with `var(--panel)`, **light and dark themes work for free** — never hard-code a hex in an archetype.
- `artKeyFor(pieceId, catId)` maps a piece to its archetype, falling back to a per-category default, so a new piece always draws something sensible.
- Adding a piece: if it looks like something already drawn, just let the mapping fall through. Add an archetype only when the new piece would otherwise be **visually identical to a different kind of thing** — that duplication is exactly what this system exists to avoid (four security pieces once shared one drawing).
- To review every archetype at once, render a contact sheet: instantiate `Component` with the Node stubs, call `artArchetypes()` and `paintArt()` for each key, and write them to a scratch HTML grid. Far faster than panning the map.

Node geometry lives in `buildMap()` (`GW=172`, `CELL_H=64`). `mapAutoFit()` runs once per session on first entry to `map` and clamps the scale to a floor (0.78) so the drawings stay legible even if the whole world does not fit; the ⤢ button still does a true fit.

### Map wiring (the cables between groups)

Cables are drawn with **orthogonal routing** (right angles, rounded corners) — the formal language of a network schematic — not free-form Bézier curves. `orthoPath(pts, r)` turns a list of axis-aligned waypoints into a path with quadratic corners; `linkRoute(A, B, lane, ctx)` decides the waypoints; `arrowHead()` and `portMark()` add the end decorations.

**A cable must never run over another group.** `linkRoute` picks one of three trays:

| Case | Route |
|---|---|
| Boxes overlap vertically (same row) | dips **below both boxes** and crosses underneath |
| Adjacent rows | straight corridor through the **gap between rows** |
| Rows further apart (`ctx.bandGap > 0`) | **vertical bus along the map margin**, clear of everything in between |

`buildMap()` records a `bands[]` entry per row and `catBox[cat]` (the bounding box of each category's column of nodes) to make that possible — anchors sit on **box edges**, never on centroids, so a cable never starts inside a card. `lane` staggers parallel cables so they don't stack.

**Three link kinds, three visual languages** — set in `wire(aCat, bCat, kind, why)`:

| kind | Meaning | Look |
|---|---|---|
| `flow` | the request path | accent, solid, 2px, **arrowhead**, animated dashes |
| `dep` | structural dependency from `deps()` | `--text-faint`, dashed `5 5`, no direction |
| `ops` | cross-cutting operation (monitoring, CI/CD, IaC, security) | `#9333ea`, dotted `2 6` |

Keep these distinct: `ops` is **not** `dep` — monitoring does not sit *under* the service, it operates *on* it. The legend renders one sample of each line, so any new kind needs a legend entry too.

Each cable carries a `tip` (`<title>` inside a `<g>`, plus a transparent 14px-wide hit path) explaining what it connects and why. Hover coverage is partial — roughly 67% of cable length on the demo stack, since cables pass under node cards, which must stay clickable — so **the tooltip is a bonus, never the only place a meaning lives**; the legend carries the primary explanation. Zone boxes are `pointer-events:none` so they don't steal hover from cables underneath.

The links `<svg>` sits **after the zones and before the labels/nodes** in the DOM: above zone fills (or the cables get washed out) and below node cards (or cables cross the illustrations). Don't reorder it.

### Map flow simulation

`runMapFlow()` walks `mapFlowCats()` (categories present, bottom-up through the stack) one step at a time via `state.flowStep`. Four things move together, and all four come from **one** source of truth — `mapFlowRoute(M)`:

- **The route**: an orthogonal polyline through the centre of each stop's `catBox`. It uses **sharp corners on purpose** — every segment is axis-aligned, so `|dx|+|dy|` is the exact length. That exactness is what lets the packet land precisely on each stop. Do not round these corners without switching to `getTotalLength()`.
- **The packet**: an HTML pill labelled `GET /` driven by `offset-path: path(...)` + an animated `offset-distance` percentage (`stopDist[i] / total`). It renders after the nodes, so it passes *over* the cards — it reads as the request entering the equipment.
- **The trail**: the same `d`, drawn inside the links `<svg>` (so *behind* the cards) with `stroke-dasharray:total` and a transitioned `stroke-dashoffset` of `total − distanceSoFar`. The route draws itself behind the packet and the whole path is still on screen when the run ends.
- **The camera**: `mapFocusCat()` re-centres on the active stop, but **only when it is outside the middle ~56% of the viewport**, so a map that already fits does not jiggle. The world div gets a `transform` transition only while `flowing`.

Nodes accumulate state: the active category gets a strong ring, already-visited ones keep a faint ring, so the path stays legible as it grows. The caption shows `n / total`, the layer name and `layerMeta[cat].flow`.

**Gotcha:** `animation:fadeUp` ends on `transform:none`, which silently kills a `transform:translateX(-50%)` used for centring. The flow caption and the chaos message are centred with a flex wrapper instead — don't "simplify" them back to a transform.

### Contextual rails (which panels a mode gets)

The three-rail grid is **not** fixed — each mode shows only the panels it needs, which is what keeps the app from feeling like a cockpit:

- `needPalette` = you are placing pieces (`sandbox`, or `mission` with an active mission).
- `needRail` = `needPalette` or `map` (the right rail carries the linter + sizing, which the map needs).
- `gridClass` picks the CSS class — `g-lcr` / `g-lc` / `g-cr` / `g-c` — defined in `<helmet>` with their own breakpoints. **Never** put `grid-template-columns` back inline on `.lab-grid`.

This matters pedagogically as well as visually: in `quiz` the palette is hidden **on purpose**, because the palette groups pieces by category and would hand the learner the answer to "which layer does this piece belong to?".

Modes that render into an absolutely-positioned container (`map`, `terminal`, `metrics`, `http`, `deploy`, `incident`) use `top:56px` rather than `inset:0`, to leave room for the `subnav` chip row. If you add another such mode, match that offset.

### The stack canvas: planes and density

The ten stackable layers are rendered grouped into the **five conceptual planes** (`planes` in `renderVals()`, derived from `families()` + a fixed plane→layer map): nube → datos → aplicación → plataforma → física. Each plane draws a coloured left edge, its name, an `n/m` counter and a one-line role from `t.planeRoles`. Grouping turns ten items into five, which is what makes the stack legible at a glance.

`state.density` (`'compact'` default, persisted) drives a per-layer set of precomputed style values (`pad`, `iconBox`, `iconSz`, `showHint`, `compactChips`, `detailChips`) plus `layerGap`/`planeGap`. Compact fits the whole stack on one screen with placed pieces as chips on the right; detail restores the per-layer explanation. Because the template dialect has no ternaries, **both densities share one markup** and differ only by those bound values — add new density-sensitive styling the same way.

The seven transversals render as a horizontal **belt** below the stack (`grid-template-columns:repeat(auto-fit,minmax(108px,1fr))`), not as vertical rails. Their labels are horizontal; do not reintroduce `writing-mode:vertical-rl`.

## Visual system (phase 3 — done, keep it)

Two scales, and **nothing outside them**:

- **Type**: `10 · 11 · 12 · 13 · 15 · 17 · 20 · 26 · 32 · 44 · 58` (was 30 arbitrary values across 456 usages).
- **Radius**: `6 · 10 · 14 · 20 · 99` (was 22 values). `99` is the pill.

Every `font-size` and `border-radius` lives inline in the template — there are none in the logic — so slipping in an off-scale value is easy and invisible. Resist it: if a new size feels necessary, the answer is almost always an existing step.

Also gone, deliberately: the `gridDrift` background animation, the two radial gradients on `.lab-root`, and the hard-coded dark header. The header now reads `var(--header-solid)` (white in light, `#0f172a` in dark) so it belongs to the theme instead of fighting it. To bring the always-dark header back, that one token is the only edit.

## Progress spans every mode

Kids, Desk and Events are **not** side attractions: `evalAchievements()` unlocks `oncall` / `veteran` (desk tickets), `triage` (all noise events closed) and `tower` (a Kids game finished), and `learningPathExtra()` appends two steps that end the path on the service desk. Those two steps mark themselves done **from real work** — a solved ticket, closed noise — never by hand. Add a mode and it must earn a place here, or nobody will find it.

`persist()` now also stores `deskSolved`, `evAck` and `evClosed`: twelve tickets are hours of work and losing them to a page reload is not acceptable. Kids progress stays unsaved on purpose — short games, and half a game confuses more than it helps.

## Puesto Linux (`puesto-linux/`) — a separate app

A replica of a real job posting (Linux sysadmin: OpenStack, Ceph, Ansible/Terraform, on-call incidents). Open `puesto-linux/index.html`; LabStack's home links to it and it links back. Same rules as LabStack: double-click, no server, no internet, `<script src>` never `fetch`, fonts from `../vendor/`.

**It is deliberately not a `.dc.html` mode.** The lesson is fixing a platform with real commands against state that changes over time; the template dialect (no ternaries, everything precomputed in `renderVals()`) would fight a stateful shell, and the engine must run in Node for the tests. So: vanilla JS, no React, no build.

| File | Holds |
|---|---|
| `motor.js` | State of 12 nodes (services, disks, logs, NTP, kernel), the simulated clock, alerts, the shell (parser, pipes, `&&`, `sudo`, the `ssh` stack) and the Linux commands. Defines the registries the other files hook into. |
| `cmd-ceph.js` | The Ceph model and `ceph`, `ceph-volume`, `smartctl`, `lsblk`. |
| `cmd-openstack.js` | VMs, the scheduler, cells, quotas, security groups; `openstack`, `nova-manage`, `virsh`, `rabbitmqctl`. |
| `cmd-auto.js` | Inventory, playbooks, the Ansible runner, Terraform, `amtool`, and the bastion's files (RUNBOOK, openrc, `~/infra`). |
| `averias.js` | **The fault catalogue**: 14 fault types plus 6 set-up conditions. Every ticket is built from these; see below. |
| `incidencias.js` | Loads an incident from a `.json` file (format `puesto-incidencia/1`): structure checks, the catalogue validator, and a **rehearsal**: apply it to a fresh platform, it must break something, and the chained reference fix must resolve it. Missing hints, cause, lesson and practices are generated from the faults. Also `exportarIncidencia` (any fault-only ticket as a template) and `catalogoLegible`. |
| `guardia.js` | Generated on-call shifts and chaos. `P.familias`: 15 *families* (coherent groups of faults: a huge log **and** the RabbitMQ that cannot start because of it), each with a level 1-3, a lesson and a `crear(rnd)` that picks random parameters. `P.generarGuardia(nivel, semilla)` picks `nivel` families (the first one of that exact level), builds an incident and runs it through `P.cargarIncidencia`; if it is not solvable or has no alert it tries the next combination. `P.provocarCaos(st, semilla, previas)` schedules a random level ≤2 family a few minutes ahead on a running platform (`st.programados`), and `P.pendientesCaos` checks what it broke and what it dragged down. |
| `compositor.html` + `compositor.js` | The teacher's composer. A form over the catalogue: every field is generated from `P.camposAveria` (in `averias.js`: one `{k, t, …}` per parameter, `t` being `nodo`, `servicio`, `osd`, `proyecto`, `num`…), so a new fault type shows up with no change here. Every edit re-runs `P.cargarIncidencia` (the same loader as Import) plus a preview through `P.construirIncidencia` + `P.preparar`; the draft lives in `puesto-linux-borrador` and «Guardar en la cola» writes to `puesto-linux-importadas`, exactly what the queue reads. |
| `validar-incidencia.js` + `incidencias/` | The same loader from the command line (`npm run validar -- file.json`, `npm run catalogo`), and two example incidents that the test requires to be accepted. |
| `escenarios.js` | The 20 tickets, mapped to the four functions of the posting. Each one *declares* its faults; none has code of its own to break things. |
| `app.js` + `index.html` | The UI: the queue, then the desk (platform + terminal tabs + ITSM ticket). `index.html#INC-4821` opens that ticket directly. |
| `soluciones.js` + `solucionario.js` + `soluciones.html` | The answer book: per ticket, each step's phase (`diag`/`arreglo`/`comprobar`) and *why*, plus a 59-term glossary. The commands are not repeated there: they come from each scenario's `guion`, and the page runs the guion in the simulator on load to show the **real output** of every step, so it can never drift from the engine. The test fails if `pasos` and `guion` stop matching command by command. |
| `estilos.css` | Shared by both pages. |
| `puesto-test.js` | Its suite; part of `npm test`. |

**One source of truth.** Nothing is canned. `ceph -s`, the OSD bars in the panel and the `CephOSDDown` alert all derive from the same state, so a command that fixes something fixes it everywhere. OSD usage is *computed* (`datos × reweight ÷ Σreweight + sesgo`) and interpolated while `rec` runs, which is why `ceph osd out`, a reboot or `ceph balancer on` move the numbers on their own.

**Time.** Every command costs one simulated minute (`help`, `cd`, `ssh`… cost zero); `sleep N` advances `ceil(N/60)`. Ceph marks a down OSD out after `downOut` = 10 min unless `noout` is set; a Ceph node takes 12 min to reboot, the others 4. Those two numbers are what make the maintenance lesson work: reboot without `noout` and data moves. `puesto-test.js` asserts both halves.

**Scheduled events.** A scenario can put `{ min, fn }` in `st.programados` and the clock runs it at that minute (CHG-0224 uses it: a pipeline creates a VM mid-maintenance, which is exactly why the hypervisor must be disabled first). **Hidden answers:** a `pendiente` with `oculto: true` (a password prompt) is echoed empty in the UI and logged as `********` in `st.registro` and the report.

**Registries** (all on `window.PUESTO`): `comandos`, `ficheros`, `reglas` (what prevents a unit from starting, as a `motivos` key), `motivos` (journal lines, result, `limite` for systemd's start limit), `ticks`, `detectores` (alerts), `alCrear/alArrancar/alParar/alApagar/alVolver`, `generadoresLog`. New behaviour hooks in; a command never special-cases a scenario.

**Adding a command:** `U.cmd(name, { fn, donde: [roles or hosts], fuera: 'hint shown elsewhere', ayuda, grupo, completar })`. `fn(ctx)` returns lines `{t, c}`. Class `err` means *failure* (it breaks a `&&` chain); `rojo`/`ambar`/`verde` are colour only, so use `rojo` for red text inside a successful output (journal errors, `df` at 100 %). Privileged actions go through `U.sinRoot(ctx, lines)`, which returns the real denial plus one dim line suggesting `sudo`.

**The fault catalogue** (`averias.js`) is what makes incidents composable. A fault type knows three things: `aplicar(st, a)` breaks, `pendientes(st, a)` says what is still broken, `arreglo(a, st)` is a reference fix in commands. It also declares `params`, an `ejemplo`, `validar` and `toca` (the resources it touches, so the validator rejects two faults on the same unit). `orden` decides the order when fixes are chained: base services, disks and flags first (1), what depends on them next (2), resources last (3). *Conditions* (`condicion: true`: a project near its quota, full hypervisors, a VM a pipeline will create at minute 6, context lines in the Ceph log) set the scene and have neither pendientes nor fix.

Faults **propagate**: `servicio-caido` and `servicio-parado` run the `P.alCaer` hooks at the fault's own time, so stopping libvirtd drags nova-compute down without anyone declaring it, and their fix restarts `P.dependientes` of the unit. A ticket's `resuelto` also calls `P.pendientesUnidades`: **nothing may stay in failed without an explanation** (the only accepted one is an OSD that is out with a dead disk). That is what catches cascades nobody named.

The test holds the catalogue to three promises: every fault type, alone, breaks something and its fix leaves the platform healthy; in every ticket made only of faults, chaining the faults' fixes resolves it with no hand-written script; and an invented combination of five faults validates, alerts, cascades and resolves the same way. A new fault type must pass all three.

**Adding a scenario** (`escenarios.js`) and the rules the test enforces:
- `averias: [{ tipo, ...params }]` composes it from the catalogue. It is data, not code, which is what will let an incident come from a file. `objetivo(st, P)` exists only for requests and changes (a project, a kernel, a new hypervisor), where nothing is broken and something new is asked for. `resuelto` is derived: faults' pendientes + objetivo, then Ceph healthy, no unexplained failed units and no customer VM left off. It checks **state**, never which commands were typed.
- `soloPractica: true` on a fault applies it and chains its fix, but does not block closing (INC-4833 uses it: RabbitMQ left in debug is a practice, not a requirement).
- A fault the catalogue lacks is added **to the catalogue**, with its `ejemplo`, never as ad-hoc code in a ticket.
- …and with its entry in `P.camposAveria`: the test fails a parameter with no field (only `nota` is exempt). A field with neither `def` nor `opcional` is **required**: `P.validarAverias` reports it as «falta servicio» before running the type's own `validar`, so neither the composer nor an imported file ever shows «undefined».

**Generated guardias are deterministic.** Everything comes from the seed (a mulberry32 PRNG, `P.azar`), so a shift can be replayed or passed to a colleague as a number, and the test pins 30 seeds per level: every one playable, with alerts, of its level, identical when regenerated, and closed by its own script with all its practices. Solved generated shifts are counted per level (`guardias` in the progress store), not per id. A new family must be coherent on its own (its faults make sense together), must validate with any `rnd`, and needs a `leccion`: it is what the closing screen and the chaos reveal show.

**Incidents from a file.** Nothing from the file is ever executed; it is data, validated and then rehearsed. Imported incidents live in `P.importadas` (persisted as their source JSON under `puesto-linux-importadas`, re-validated on every start, so one that stops being valid shows as such instead of vanishing) and `P.escenario(id)` finds them, so they open, score and report like any ticket. They are **not** in `P.escenarios`: they do not count toward the four functions, but *«un ticket del puesto al azar»* in Guardia draws from built-ins and imports alike (only incidents that raise at least one alert). Their generated practices are the generic three (look before touching, check after the last change, no node reboots); their `guion` is `amtool alert` + the chained fixes + `amtool alert`. The rejections the test pins down: broken JSON, wrong `formato`, missing fields, bad enums, an `id` a built-in uses, oversized text, unknown fault, an incident that breaks nothing, one whose fix cannot work (a 32 GB VM to restore into a full cloud) and a P1 born with its SLA half spent. No alert is accepted, with a warning.
- `practicas` are judged from `st.registro` / `st.hechos`, never asked. They are what separates knowing from guessing.
- `guion` is a reference solution. **It must resolve the ticket and pass every one of its own practices**, and running it twice must give identical output.
- `trampas` are half-fixes that must *not* close it (or, with `practicas: [i]`, must fail those practices).
- `inicio` (when the fault began: the alerts' "since") and `abierto` (when the ticket was logged: the SLA clock) are different. A ticket born with more than half its SLA spent fails the test. It happened once: INC-4847 opened on a red, already-breached bar.
- Every `incidente` needs at least one alert, or Guardia mode (alerts only, no ticket) cannot be played. That rule caught the security ticket, which is why `PublicSSHExposed` (an external blackbox probe) exists.
- Exactly three `pistas`, progressive, naming only commands the simulator knows.

**Language.** Spanish and English. `P.idioma` is decided **once per page load** at the top of `motor.js` (`?lang=` in the URL, then `localStorage['puesto-idioma']`, then the browser), and the EN/ES header button calls `P.cambiarIdioma()`, which **reloads**. That is what makes `T(es, en)` (= `P.T`) safe everywhere, including data built at load time: every user-visible string is `T('…', '…')` with the Spanish byte-for-byte as it was. Static HTML text carries its English in `data-en` / `data-en-title`. Never translate what code compares (ids, fault types, `impacto: 'alto'`, fase values, handler names…): displayed enums go through a map at render time. Command output imitates real tools and stays English in both; what the *team* wrote (alert summaries, playbook task names, RUNBOOK, hints) is translated. LabStack's home opens the desk with `?lang=` matching its own language. `ingles-test.js` loads everything in English, walks every string a player can see (data, alerts, pendientes, validator messages, `help`, every file on five nodes, the output of all 20 reference scripts) and fails on anything that looks Spanish; it also resolves the 20 tickets in English. Add a string without its English and it fails.

**The incident loader and the composer are shared too.** `incidencias.js` reads `P.incidenciasCfg` and `compositor.js` reads `P.compositorCfg` (both optional: without them, everything is the Linux desk's, byte for byte); `app.js` takes the imports key from `UI.claveImp` and hides «start from a ticket» when a desk has no exportable ticket.

**The core is shared with Puesto Cloud.** `motor.js` reads `P.topologiaInicial` if it is set before loading (otherwise the 12 OpenStack nodes); the first node is `P.entrada`, where every session starts and where you are thrown back when the node you are on goes down. A node may declare `unidades`, `discos`, `logs`, `ram`, `ramBase` and `kernel` instead of deriving them from its role, and `U.crearHost(d, min)` builds one mid-game (an EC2 launch). `app.js` reads `P.ui` (declared before it loads): offer text, "how it works", welcome lines, the left-hand panels, free-lab experiments, the storage key, and whether Guardia, imports and chaos exist. Without `P.ui` it is exactly the Linux desk. Change either file and both test suites must still pass.

**Screenshot gotcha.** Headless Chrome on Windows will not lay out narrower than ~490 px whatever `--window-size` says, and then crops the capture. It looks like horizontal overflow and is not. To see a phone width, render the page inside a 375 px `<iframe>`.

## Puesto Cloud (`puesto-cloud/`) — the same desk, on AWS

A cloud systems engineer's job (EC2 and EBS, VPC networking and security, CloudWatch and incidents) on a simulated AWS account. Open `puesto-cloud/index.html`. **It is not a fork**: it loads `../puesto-linux/motor.js` and `../puesto-linux/app.js` and only adds what is different. Independent educational simulator: it uses AWS service and command names because that is what is taught, but never AWS branding, and the page says it is not affiliated.

| File | Holds |
|---|---|
| `topologia.js` | Loaded **before** the motor: `P.topologiaInicial` = your workstation (`ops`, the entry point with the AWS CLI and SSH keys) plus the five EC2 instances as real Ubuntu nodes (`bastion`, `web-01/02`, `app-01`, `db-01`). Inside them `systemctl`, `journalctl`, `df`… are the Linux desk's. |
| `nube.js` | `st.aws`: VPC, 5 subnets (3 public, 2 private), two route tables, NAT gateway, security groups (plus `default`), instances, EBS volumes, snapshots, AMIs. **Reachability** (`N.desdeInternet`, `N.desdeVpc`, `N.ipSalida`): running + OS up + public IP + route to the IGW + a security group rule from that source. Lifecycle (`N.parar/arrancar/terminar/lanzar`, with a new public IP on start), volume modifications (`modifying` → `optimizing` → `completed`), CloudWatch alarms (`N.alarmas`, replacing the motor's detectors), the workstation's files (`~/.ssh/config` with ProxyJump, `~/.aws/`, `~/LEEME.md`) and `ssh`, `curl`, `lsblk`, `growpart`, `resize2fs`. |
| `aws.js` | The `aws` CLI, only on `ops`: `sts`, `ec2` (instances, status, start/stop/reboot/terminate/run, console output, `wait`, security groups, VPC/subnets/route tables/NAT/IGW, volumes, modifications, snapshots, images, key pairs, tags) and `cloudwatch describe-alarms`. JSON with the real field names, `--output text|table`, `--filters`, `--region` (another region is empty), `--dry-run`, and errors as `An error occurred (Code) when calling the Op operation`. `--query` is a small **JMESPath** interpreter with real projection semantics: a pipe stops a projection and a filter after a projection applies per element — the test pins both. |
| `servicios.js` | Phase 2, loaded after `aws.js` and hooked into it through `N.cli`. **IAM**: users, groups, roles, instance profiles and managed policies with versions; `N.identidad` (your workstation is the admin user `sre-ops`, an instance with a profile is `assumed-role/ROLE/i-…`, an instance without one has no CLI at all) and `N.evaluar` / `N.autorizar`, a real evaluator: explicit Deny wins, otherwise an Allow must match action and resource (globs), otherwise implicit deny, with the real `UnauthorizedOperation` / `AccessDenied` messages. Every CLI operation is authorised before it runs (`fn.permiso` declares the action and resource; default `prefix:OpName` on `*`). **S3**: buckets with policy, Block Public Access, versioning and objects (`aws s3 ls/cp/rm/presign`, `s3api`), and `curl` to a bucket URL answers 200 / 403 / presigned. **ELB**: an ALB with one target group; health is computed from the instance, the security group and whether nginx serves the health-check path, and needs ~2 min of successes to become `healthy`; when every target is unhealthy the ALB is **fail-open**, as the real one. The capacity and canary alarms now measure the load balancer. Also: instances in another region (`--region`), which `describe`/`terminate` do not see without it. |
| `rds.js` | Phase 3. The RDS orders database `tienda-pedidos` (and any point-in-time copies): `modify-db-instance` without `--apply-immediately` only fills `PendingModifiedValues`; with it, `modifying` → `storage-optimization` → `available`; storage must grow ≥ 10 %; `--max-allocated-storage` autoscales. `restore-db-instance-to-point-in-time` always creates a NEW instance, born with the `default` security group unless told otherwise. `psql` on app-01 reaches an instance only if its security group lets the API in, and knows whether the deleted order is in a copy (`N.rdsTienePedido`). |
| `asg.js` | Phase 3. `tienda-workers`, an Auto Scaling group of host-less instances with a versioned launch template. Every minute it reconciles desired vs running; if it cannot launch (e.g. the AMI was deregistered) it writes a Failed activity and retries every 2 min. `create-launch-template-version` / `modify-launch-template` and the `autoscaling` CLI. |
| `coste.js` | Phase 3. Every resource costs per hour while it exists (approximate eu-west-1 on-demand prices): `N.ritmo` ($/h now), `N.gastado` (month to date), `N.prevision`; `aws ce get-cost-and-usage` grouped by service or tag, `get-cost-forecast`, `budgets describe-budgets`, Elastic IPs, `delete-volume`. The anomaly alarm compares against the healthy account's rate, fixed at creation — what is already spent never comes back, so tickets are closed by stopping the bleeding, not by meeting the budget. |
| `terraform.js` | Phase 3. `~/infra` declares `tienda-web`'s rules and the backups bucket's public access block. `terraform plan` diffs the code against `st.aws` (drift), `apply` asks for `yes` and makes the account match. A healthy account has no drift (tested). |
| `averias.js` | Phase 4. **The cloud fault catalogue**, same API as the Linux one: 15 fault types and 1 condition (`P.averias`, each with `aplicar`, `pendientes`, `arreglo(a, st)`, `validar`, `toca`, `orden`, `params`, `ejemplo`), `P.camposAveria` for the composer, and `P.aplicarAverias` / `pendientesAverias` / `arregloAverias` / `validarAverias`. Loaded **before** `escenarios.js`, which takes `N.CARGA` / `N.idMalo` from it. Also holds `P.incidenciasCfg` (what the shared loader needs to know about this desk: the alarms command, the look/touch regexes for the practices, the function, area and «where to look» of each type, and `maxHace` = one month, because the load-test bill is weeks old) and `P.compositorCfg` (its own localStorage keys, so it never writes into the Linux queue). |
| `guardia.js` | Phase 3. `P.familias`: 11 families, levels 1–3, each with `params(rnd)`, `aplicar`, `pendientes`, `arreglo`, `toca`. `P.generarGuardia(nivel, semilla)` combines non-overlapping families (mulberry32 seed) and only returns a shift its own fix closes; `P.provocarCaos` schedules one a few minutes ahead in the free lab. Phase 4: each family is also said with the catalogue (`COMO` → `f.averias(p)`, `f.crear(rnd)`), and a generated shift carries `def`, the same night as an incident file — that is what the composer's «+ Add family» and «Start from a shift» use. |
| `escenarios.js` | 15 tickets with the Linux desk's contract. Since phase 4, 13 of them **declare** `averias: [...]` from the catalogue instead of carrying their own `aplicar` / `objetivo` (that is what makes them exportable as templates); REQ-7120 and REQ-7154 keep an `objetivo` because something new is asked for. `resuelto` = faults' pendientes + `objetivo` + **no CloudWatch alarm in ALARM**. |
| `compositor.html` | Phase 4. The teacher's composer: the page loads `../puesto-linux/compositor.js` unchanged on top of the cloud platform (field types `opciones`, `num`, `bool`, `lista`, `texto`). |
| `ui.js` | `P.ui`: the job offer, the EC2 / load balancing and scaling / storage (RDS + EBS) / S3 / routes / monthly cost panels, welcome lines and experiments. Guardia, chaos and imports are all on; imported incidents live under `puesto-cloud-importadas`. |
| `soluciones.js` + `soluciones.html` | The answer book, rendered by `../puesto-linux/solucionario.js` (which runs each `guion` live, so it shows the real output). Steps are `[fragment, phase, why]`: the fragment must appear in the command at that position of the guion (AWS ids are too long to repeat), and the test fails if they drift apart. `P.solucionarioCfg` swaps the two texts that were Linux-specific; 26-term AWS glossary. |
| `nube-test.js` | Its suite, part of `npm test`. |

What the network must keep doing, because it is the lesson: **a security group drops, it does not reject** (`ssh`/`curl` time out; only a stopped service gives `Connection refused`); a private IP is unreachable from the workstation except through the bastion (`-J` or `~/.ssh/config`); `-J` without `-i` does not use the project key; Ubuntu AMIs log in as `ubuntu`; an instance launched without `--security-group-ids` gets `default` and is invisible from outside; a route to a deleted NAT is a `blackhole`; in a public subnet there is no egress without a public IP. On EBS, `modify-volume` grows the block device (`lsblk`) but not the filesystem (`df`) until `resize2fs` (and `growpart` for the partitioned root), and a volume can be modified only once every 6 hours.

Phase 2 adds its own non-negotiables: in IAM whatever nothing allows is denied, and the AccessDenied message names the exact action and resource; `arn:aws:s3:::bucket` is the bucket and `arn:aws:s3:::bucket/*` its objects; a public bucket needs a public policy **and** Block Public Access off; deleting in a versioned bucket leaves a delete marker; a new instance receives no traffic until it is registered in the target group and passes its health checks; the ALB fails open; the CLI only sees the region it is told. Phase 3: an RDS change without `--apply-immediately` waits for the maintenance window; a point-in-time restore never overwrites production; an Auto Scaling group that cannot launch only says so in its activity history; you pay for what exists, not for what is used; a manual change to a Terraform-managed resource is drift.

Every id (instances, subnets, security groups, volumes, the target group, access keys) is deterministic, derived from `U.hex`, and so is the pool of public IPs handed out on start, which is what lets a ticket's `guion` name them.

## Tests

`npm test` (or `node test.js`) runs all eight suites and prints one line each:

| Suite | Covers |
|---|---|
| `smoke.js` | `renderVals()` in all 12 modes, template bindings, achievements across the new modes, persistence round-trip |
| `content-test.js` | cross-file references, ES/EN parity, ticket and Kids content rules |
| `kids-test.js` | both Kids games end to end |
| `desk-test.js` | 12 tickets, command hints, wrong-host nudge, coherence after resolving |
| `events-test.js` | correlation, triage, the event to incident bridge |
| `puesto-cloud/nube-test.js` | IAM (role vs user, implicit deny, two keys per user), S3 (public, presigned URLs that expire, versioning), the load balancer (fail-open, health-check reasons, 503) and regions; the cloud platform healthy at start, security groups that drop (timeout vs refused), user and key, private IPs only through the bastion, new public IP on start, volume vs filesystem and the 6-hour limit, regions, the `default` security group, `--query` semantics and output formats, RDS pending changes, Auto Scaling self-healing, cost and drift of a healthy account, 90 generated guardias (30 seeds × 3 levels) and chaos, the fault catalogue (each type alone breaks something and its fix leaves no alarm, in both languages; every fault-only ticket closed by chaining its faults' fixes; an invented five-fault combination; the validator's rejections), incident files (every exportable ticket round-trips, generated texts with no Spanish in English, loader rejections, guardias as files) and the composer, the 15 tickets solved by their script with all practices, determinism and half-fixes, and the same in English with no Spanish left |
| `puesto-linux/ingles-test.js` | the Puesto in English: no Spanish left in anything a player sees, and the 20 tickets resolved the same way |
| `puesto-linux/puesto-test.js` | the 20 Puesto Linux tickets solved by their reference script, the fault catalogue (each fault alone, chained fixes, an invented combination, the validator), incidents from files (examples, export/re-import round trip, rejections), generated guardias (30 seeds × 3 levels) and chaos, the composer (one control per schema field for all 20 types, every exportable ticket and a level-3 guardia loading and saving as playable, a missing parameter named as such), the answer book aligned with each script, their practices, half-fixes that must not close them, `noout`, `sudo`, openrc, Terraform's folder, Ansible idempotency and `--check`, Tab |

Nothing to install; `package.json` exists only to hold the scripts.

## Console noise at load (expected, not a bug)

Opening the app logs **16 `<path> attribute d: Expected moveto…` errors**. They are inherent to the `.dc.html` format and **do not affect rendering**:

The browser parses the inline `<x-dc>` template into real DOM *before* the runtime compiles it. SVG validates geometry attributes, so a literal `d="{{ x }}"` is rejected and logged. The string itself survives in the attribute, the runtime reads it with `getAttribute` and compiles it correctly. Measured identical over `file://` and `http://` — it has nothing to do with the protocol. Fixing it would need runtime support (the template would have to live somewhere inert), and `support.js` is generated outside this repo.

Two families of error **were** removed and must not come back:

- `<svg> attribute width/height: Expected length` — bind the size through `style="width:{{ x }}px"` instead of the `width`/`height` attributes. An invalid CSS declaration is dropped silently; an invalid SVG attribute is not. Same rendered result.
- `CORS policy` + `ERR_FAILED` on `file://` — `boot()` in support.js re-fetches the page source to recompile the template from raw text, which CORS always blocks on `file://`. The runtime catches it, but the browser still logs it. A one-line guard before `support.js` sets `window.__resources = {}` **only when `location.protocol === file:`**, which makes the runtime skip that fetch. Over HTTP the fetch is useful and is left alone.

Anything **other** than those 16 `d` lines is a real problem worth chasing.

## support.js — do not edit by hand

The first line says it all: `GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with cd dc-runtime && bun run build`. **The `dc-runtime` source is not part of this repository** — only the bundled output ships here. Treat `support.js` as read-only; to understand runtime behavior, read it (sections are labeled `// src/<file>.ts`: `parse`, `compile`, `expr`, `logic`, `component`, `runtime`, `index`, …), but make behavioral changes in the `.dc.html` file, not the bundle.

## Working conventions

- The whole app is styled with inline `style="…"` attributes driven by CSS variables (`var(--accent)`, `var(--panel)`, …) defined in the `<helmet>` block, with `.theme-dark` overrides. Add new colors as variables there rather than hard-coding hex values inline, so light/dark both work.
- When adding a block: add it to `blocks()` with its `cat`, and ensure that category exists in `cats()` (and, for a stackable layer, in `layerMeta()` and `stackIds`).
