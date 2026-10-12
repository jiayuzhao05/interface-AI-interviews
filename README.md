# interface AI interviews

## Horizon Core sample app

Local stand-in for a credit-union member servicing screen. One process serves two configurations of the same pages.

```bash
npm install
npm run horizon
```

- Base (Horizon Credit Union): http://127.0.0.1:4173/members — field label “Member number”
- Variant (Northline Credit Union): http://127.0.0.1:4173/cu/members — field label “Account ID”; dismiss the branch notice before the first lookup

Demo members: `10001`, `10002`, `10003`. Any other number shows “No member matches.”

## Surface

`observe()` reads the accessibility tree. `act()` only navigates, clicks, types, or extracts text. A screenshot is written to disk and is not an input to either call.

The allowlist is `config/policy.json`: host `127.0.0.1`, actions `navigate`, `click`, `type`, and `extract`. A button named Confirm, Submit, Transfer, or Delete is refused unless the caller passes `{ allowIrreversible: true }`.

```bash
npm run lookup
```

That opens the base app, enters member `10001`, and prints the savings balance. The sample app has to be running.

## Capability

`capabilities/lookup_savings_balance/v1.json` is a hand-written capability. The member number appears only as `{{inputs.memberId}}`. `variants/horizon-variant.json` is the Northline overlay: route prefix `/cu`, field label Account ID, and a dismiss action for the branch notice. Zod schemas in `src/schema/capability.ts` reject anything else. Replay (`src/replay/engine.ts`) runs that file with parameters and an optional variant, without calling a model. `npm test` covers a found balance, a missing member, and the Northline notice.

## Discovery

`npm run discover` asks a model for one action at a time, using the goal and the control list from `observe()`. The key stays in the environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY`. Optional model overrides are `ANTHROPIC_MODEL`, `OPENAI_MODEL`, and `XAI_MODEL`.

A successful run writes `evidence/discovery-<id>/` with `trajectory.json`, screenshots, and `capability.json`. That file is the same schema as the hand-written capability. Trial steps are removed, and the member number used during discovery is stored only as `{{inputs.memberId}}`. The sample app has to be running. The command then replays the generated file once, still without the model.

## Handoff

A browser session is owned by `automation` or `human`. Looking up a savings balance stays with automation. An unknown dialog, or the Submit button on the sub-account confirmation, switches the owner to `human`, leaves the window open, and writes `evidence/interventions/<id>.json` plus a screenshot. The card records the capability, the step, and the reason.

The person uses that same window. While they do, the session records URL changes. `POST /v1/interventions/<id>/resume` sets the owner back to automation, re-reads the page, stores the control diff, and continues.

```bash
npm run handoff
```

That opens a visible browser on the sub-account confirmation for member `10001`. Submit it in the window, then run the `curl` command the script prints. The intervention API listens on `127.0.0.1:4180`.

## Catalog

An agent lists capabilities, then invokes one by name. `GET /v1/capabilities` returns the name, description, parameter shape, and return shape. `POST /v1/capabilities/:name/invoke` takes `{ "params": { "memberId": "10001" }, "variant": "horizon-variant" }` and replays that capability. Omit `variant` for the base app. No model is called.

```bash
npm run agent
```

That fetches the catalog, looks up member `10001` on the base app and member `10002` on Northline, and writes both results to `evidence/agent.json`. The sample app has to be running.
