# Computer-use automation

A model drives the local Horizon Core servicing screen once. The run is saved as a capability. Later calls replay that file with new inputs and do not call the model.

## Setup

Node.js 22. The app and the tests run on this machine. Discovery is the only step that calls a model API.

```bash
npm install
npx playwright install chromium
npm run horizon
```

- Base (Horizon Credit Union): http://127.0.0.1:4173/members — field label “Member number”
- Variant (Northline Credit Union): http://127.0.0.1:4173/cu/members — field label “Account ID”; dismiss the branch notice before the first lookup

Demo members: `10001`, `10002`, `10003`. Any other number shows “No member matches.”

`npm test` does not need a model key. If the sample app is already running it is reused; otherwise the tests start it.

## Environment

Set one model key in the shell. The key is not written into the repo.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | one of these three | Discovery. Used first when more than one key is set. |
| `OPENAI_API_KEY` | one of these three | Discovery. |
| `XAI_API_KEY` | one of these three | Discovery. |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-4-5`. |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | no | OpenAI-compatible base URL. |
| `XAI_MODEL` | no | Default `grok-3`. |
| `HORIZON_ORIGIN` | no | Default `http://127.0.0.1:4173`. |
| `MEMBER_NUMBER` | no | Discovery defaults to `10001`. Replay defaults to `10003`. |
| `HEADED` | no | Set to `1` to show the browser. |
| `VARIANT` | no | Replay only. Path to an overlay, such as `variants/horizon-variant.json`. |
| `PARAMS` | no | Replay only. JSON object of strings. Overrides `MEMBER_NUMBER`. |

## Demo

Start the sample app first (`npm run horizon`). Replay does not call a model. With member `10003` it should print a savings balance of `$15,240.33`.

```bash
npm run replay -- capabilities/lookup_savings_balance/v1.json
```

Discovery needs one of the keys above. After it succeeds, replay the file that run writes:

```bash
npm run discover
npm run replay -- evidence/latest/capability.json
```

`npm run discover` writes `evidence/discovery-<timestamp>/` (`trajectory.json`, screenshots, and `capability.json`) and copies the capability to `evidence/latest/capability.json`. That copy does not exist until discovery succeeds. Paste the replay line discover prints. The shell treats an unquoted `<id>` as a redirect, so do not type that placeholder yourself.

`npm run replay` writes `evidence/replay/<capability>-<memberId>-<status>.json` and a screenshot of the page it stopped on. Member `99999` is a not-found outcome:

```bash
MEMBER_NUMBER=99999 npm run replay -- evidence/latest/capability.json
```

To replay the same file against Northline, set `VARIANT=variants/horizon-variant.json`.

## Other commands

`npm run lookup` types member `10001` on the base app and prints the savings balance. It does not use a capability file.

`npm run handoff` opens a visible browser on the sub-account confirmation. Submit stays with you. The script prints a `curl` command for `POST /v1/interventions/<id>/resume` on `127.0.0.1:4180`. Set `HEADLESS=1` to hide that window. `INTERVENTION_PORT` changes the port.

`npm run agent` lists `GET /v1/capabilities`, then `POST /v1/capabilities/lookup_savings_balance/invoke` for the base app and for Northline. Results go to `evidence/agent.json`.
