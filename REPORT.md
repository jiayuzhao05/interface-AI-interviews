# Computer-use automation

## 1. Architecture

The sample bank and the automation live in one Node process family. Horizon Core is a server-rendered credit-union screen on `127.0.0.1:4173`, with no test ids and with the member detail inside an iframe. Two institution configs share the page logic: Horizon at `/members`, Northline at `/cu`.

A command launches Playwright, talks to that app, and exits. There is no queue. The boundaries are the surface, the capability file, replay, discovery, the human session, and the catalog.

The surface exposes `observe()` and `act()`. `observe()` reads the accessibility tree and returns controls with role, name, and whether they sit in an iframe. `act()` only navigates, clicks, types, or extracts. Screenshots are written to disk as evidence. Decisions use the tree. That choice fits pages that have no stable DOM ids, and the same contract can later sit on a desktop accessibility tree.

Discovery asks a model for one structured action at a time, checks policy, then acts. A successful trace is compiled into `capability.json`. Replay and the catalog execute that file. The model is not in those paths.

## 2. Artifact schema

A capability is a versioned JSON file checked by Zod. It names the flow, declares string inputs and outputs, lists ordered steps, states a success path, and lists business outcomes. Steps are `navigate`, `type`, `click`, or `extract`. A target is a role and name, a landmark path, or nearby text. Those are tried in that order, including inside iframes. Extract binds exactly one declared output.

Values that change per call are templates: `{{inputs.memberId}}`. The compiler deletes trial steps from the discovery trace, replaces the concrete member number and the matching path segment with that template, and records the role and name of the control that was used. The balance amount is not stored as a locator. Extract points at the label “Savings balance”, because the dollar amount changes every member.

Northline is not a second recording. `variants/horizon-variant.json` is an overlay: route prefix `/cu`, label “Member number” to “Account ID”, and a click that dismisses the branch notice. Replay applies the overlay to the base file.

## 3. Determinism & error handling

Replay fills templates, applies the variant, locates a control, acts, and checks the step. The same inputs produce the same steps. There is no model call and no coordinate click.

The result has four statuses.

- `success` means the success path was reached and each declared output matched its pattern.
- `outcome` is a business result the caller needs. “No member matches.” returns `member_not_found`. A field message ending in “is required.” returns `validation_error`.
- `failed` stops the run and records the step, what was expected, and what was on the page. That covers a missing control, a path or output that does not match, a session-expired message, and a policy denial that is not a handoff.
- `escalated` means the run stopped for a person: an unknown dialog, or a click on Confirm, Submit, Transfer, or Delete.

A registered notice, such as the Northline branch notice, is clicked, noted, and the run continues. An unknown dialog is not clicked.

## 4. Heterogeneity & multi-tenant

The sample page is the hostile case the design is aimed at: tables, no test ids, one iframe, two brands of the same vendor screen. Locators use the accessibility name a person would hear, then a landmark path, then nearby text. Replay does not depend on CSS classes or generated ids.

A desktop app would be another adapter behind `observe()` and `act()`. The capability file would stay the same. That adapter is not built.

Across institutions, the base capability stays canonical. A tenant overlay changes the route prefix, the field labels, and the known interstitials. One lookup file serves Horizon and Northline. The overlay in this repo is written by hand. Learning it from a second discovery run is future work.

## 5. Escalation & handoff

The browser session is marked `automation` or `human`. Lookup stays on `automation`.

Handoff happens in two cases. Replay sees a dialog or alertdialog it does not have a recovery for. Or the next click is the irreversible Submit on the sub-account confirmation. The marker switches to `human`, the window stays open, and an intervention file records the capability, the step, the reason, and a screenshot. While the person uses that window, main-frame URL changes are logged. Automation cannot act on the page during that time.

`POST /v1/interventions/:id/resume` sets the marker back to `automation`, reads the page again, stores which controls appeared, disappeared, or changed value, and continues the remaining steps. For Submit, the person’s click stands in for the automated click. For an unknown dialog, the blocked step runs again after the dialog is gone.

The operator surface is the terminal plus that POST. There is no separate co-browsing console.

## 6. Safety

`config/policy.json` allowlists host `127.0.0.1` and the actions navigate, click, type, and extract. Every act checks the host and the action before it runs. Buttons named Confirm, Submit, Transfer, or Delete are refused to automation. A person holding the session may click Submit. That click is the handoff, not a silent policy bypass inside replay.

Model keys are read from the environment. They are not committed and they are not copied into evidence. Discovery evidence stores the action log, screenshots, and the compiled capability. It does not store the prompt transcript. The compiled file replaces the concrete member number with `{{inputs.memberId}}`.

The limits are real. The allowlist is one host. The irreversible list is four exact button names. A dangerous control with a different name would still be clicked. Dialog detection depends on the accessibility role. The sample members are fake. This system is not a control for a production core.

## 7. Cuts

The depth is the capability file, replay with business outcomes, the variant overlay, and handoff on the same live browser.

Left out, and why:

- A desktop adapter. The surface boundary is the seam. Building OS automation would not change the artifact.
- A learned variant overlay. The Northline file is hand-written so replay can be tested without a second model run.
- Approval states, a stability score across repeated replays, and a model fallback when replay fails. Replay stays deterministic. A fallback would put the model back on the production path.
- An operator UI. Resume is one POST. A console would show the same intervention record.
- Queues, workers, and multi-tenant hosting. The files and the overlay are the parts that would scale. The process model would not.
- Catalog invoke waits for a person only in `npm run handoff`. `POST /v1/capabilities/:name/invoke` returns `escalated` when it hits Submit, and the caller can hand off from there.
