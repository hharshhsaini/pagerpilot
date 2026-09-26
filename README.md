# PagerPilot

[![TrueForge](https://img.shields.io/badge/TrueForge-Agent%20Harness-dfff57?style=for-the-badge&labelColor=07100d)](https://github.com/truefoundry/trueforge)
[![Daytona](https://img.shields.io/badge/Daytona-Isolated%20Recovery-65e6b2?style=for-the-badge&labelColor=07100d)](https://www.daytona.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Operator%20Control-7fa4ff?style=for-the-badge&labelColor=07100d)](https://www.typescriptlang.org/)

> An AI incident responder that investigates production incidents, correlates evidence across operational systems, safely tests remediation, and requires human approval before irreversible production actions.

Built on the TrueForge agent harness, PagerPilot turns a production page into a parallel investigation, an evidence-correlated root cause, human-gated remediation, isolated Daytona recovery, and durable operational closeout.

## Technical map

```mermaid
flowchart LR
    P[Production telemetry] --> T[TrueForge session]
    T --> A1[Logs]
    T --> A2[Metrics]
    T --> A3[Deploy]
    T --> A4[Code]
    A1 --> F[Typed evidence fan-in]
    A2 --> F
    A3 --> F
    A4 --> F
    F --> Q[Remediation choice]
    Q --> H[Human rollback approval]
    H --> D[Daytona recovery]
    D --> V[Remote verification]
    V --> C[Slack · Linear · resolution]
```

| Deep dive | What it proves |
|---|---|
| [System architecture](docs/architecture.md) | Component and data-flow boundaries |
| [TrueForge surface map](docs/trueforge-surfaces.md) | Harness depth across 20 concrete capabilities |
| [Evidence contracts](docs/evidence-contracts.md) | Typed specialists and correlation gates |
| [Safety boundaries](docs/safety-boundaries.md) | Choice, approval, mutation, and recovery separation |
| [Durable remediation](docs/durable-remediation.md) | SQLite state machine and restart reconciliation |
| [Daytona execution](docs/daytona-execution.md) | Credential-isolated recovery pipeline |
| [Operator telemetry](docs/operator-telemetry.md) | Event-derived UI and replay trust rules |
| [Security model](docs/security-model.md) | Credential, input, and external-effect boundaries |
| [Qodo review impact](docs/qodo-impact.md) | Review findings translated into architecture |
| [Verification strategy](docs/verification-strategy.md) | Static, automated, live, and responsive proof |
| [Design decisions](docs/design-decisions.md) | Critical constraints and rejected shortcuts |

## Production incidents are now the code-review bottleneck

Engineering teams can generate code faster than they can safely operate it. During the first minutes of a production incident, a human still has to open PagerDuty, logs, metrics, deploy history, source code, Slack, and the runbook before they can explain what broke.

**PagerPilot owns that first response without taking control away from the operator.**

When checkout degrades, PagerPilot acknowledges the page, launches four isolated investigators in parallel, correlates their typed evidence, renders the root cause, synchronizes the operator checkpoint across the control room and Slack, pauses before every production write, executes an approved rollback in Daytona, verifies recovery, and closes the loop with the systems responders already use.

## The pitch

A production alert fires. Before the responder finishes opening their laptop, four TrueForge subagents are already reading error logs, service metrics, recent deploys, and changed source code in parallel. They converge on one evidence-linked diagnosis: a deploy introduced serial database writes in the checkout request path, driving p99 latency above six seconds and producing deadline failures. PagerPilot recommends rollback—but cannot act until a human chooses the path and approves the exact mutation. Approval resumes the same durable TrueForge session. Daytona reproduces the regression, creates and tests the revert, pushes it, verifies the remote SHA, and stops the sandbox. PagerPilot then publishes the result to Slack, records follow-up work, resolves the incident, and preserves the entire operational history for replay.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PRODUCTION CONTROL ROOM                                  │
│                                                                                             │
│  ┌───────────────────────────────┐       terminal trigger       ┌────────────────────────┐  │
│  │ LIVE PRODUCTION MONITOR       │ ───────────────────────────▶ │ LOCAL DEMO CONTROL     │  │
│  │ checkout-svc                  │                              │ state + Slack bridge   │  │
│  │ traffic · p99 · errors · logs │ ◀──── incident / recovery ── │ signed checkpoint URLs │  │
│  └───────────────────────────────┘                              └───────────┬────────────┘  │
│                                                                            │               │
│                              creates session + turn                         │               │
│                                                                            ▼               │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              TRUEFORGE AGENT HARNESS                                  │  │
│  │                                                                                       │  │
│  │  Saved agent · persistent SQLite sessions · SSE events · OpenAI GPT-5.6-sol          │  │
│  │  Git-backed runbook skill · dynamic subagents · ask-user · approval gates · OpenUI   │  │
│  │  sandbox-as-tool · Code Mode · large-response offload · SDK automation               │  │
│  │                                                                                       │  │
│  │       ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐    │  │
│  │       │ LOG ANALYZER   │  │ METRICS        │  │ DEPLOY         │  │ CODE BLAME   │    │  │
│  │       │ first failure  │  │ baseline/peak  │  │ suspect commit │  │ exact lines  │    │  │
│  │       └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  └──────┬───────┘    │  │
│  │               └───────────────────┴──────────┬─────────┴──────────────────┘            │  │
│  │                                              ▼                                         │  │
│  │                                TYPED EVIDENCE FAN-IN                                   │  │
│  │                     temporal match · deploy agreement · symptom fit                    │  │
│  │                                              │                                         │  │
│  │                                              ▼                                         │  │
│  │                              RCA → CHOICE → APPROVAL GATE                              │  │
│  └──────────────────────────────────────────────┬────────────────────────────────────────┘  │
│                                                 │                                           │
│                         approved destructive MCP call                                       │
│                                                 ▼                                           │
│  ┌──────────────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐ │
│  │ CHECKOUT-SVC-SIM MCP         │ ───▶ │ DAYTONA SANDBOX      │ ───▶ │ GITHUB             │ │
│  │ incident · logs · metrics    │      │ clone · reproduce    │      │ push revert        │ │
│  │ deploy · code · audit        │      │ revert · test · push │      │ verify remote SHA  │ │
│  │ Slack · rollback · resolve   │      │ verify · stop        │      │ permanent-fix PR   │ │
│  └──────────────────────────────┘      └──────────────────────┘      └────────────────────┘ │
│                                                 │                                           │
│                                                 ▼                                           │
│  ┌──────────────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐ │
│  │ SLACK #pagerpilot-demo       │      │ LINEAR               │      │ PAGERDUTY SIM      │ │
│  │ investigation · checkpoints │      │ tested follow-up     │      │ acknowledge/resolve│ │
│  │ final RCA + recovery links   │      │ permanent guard     │      │ durable audit      │ │
│  └──────────────────────────────┘      └──────────────────────┘      └────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Live demo

[![Watch the PagerPilot demo](https://img.shields.io/badge/WATCH%20THE%20LIVE%20DEMO-Google%20Drive-dfff57?style=for-the-badge&labelColor=07100d)](https://drive.google.com/file/d/1IiIjKej4pJRGZCOj1R7P0gQOkSg3rM3d/view?usp=drive_link)

**[Open the full video demo →](https://drive.google.com/file/d/1IiIjKej4pJRGZCOj1R7P0gQOkSg3rM3d/view?usp=drive_link)**

## TrueForge depth

PagerPilot uses the harness as the execution system—not as a model wrapper.

| TrueForge capability | How PagerPilot uses it |
|---|---|
| Custom MCP | Twelve incident, evidence, rollback, audit, and provider tools over Streamable HTTP |
| Multiple connectors | Custom incident MCP, official GitHub MCP, official Linear MCP |
| Dynamic subagents | Four sibling investigators launched together with isolated contexts |
| Typed subagent contracts | Invalid prose, missing evidence, and incomplete unknowns block correlation |
| Persistent sessions | Session, turns, checkpoints, and events survive browser and process reconnects |
| SSE streaming and replay | Live event ingestion plus deterministic replay into the command board |
| Ask-user | Remediation selection is a real paused TrueForge required action |
| Tool approval gates | Rollback, Slack, Linear, and resolution require explicit approval |
| Generative UI | Correlated RCA and remediation evidence render through native OpenUI |
| Sandbox-as-tool | Independent sandbox execution remains visible in the durable session |
| Daytona | Approved rollback runs in an ephemeral remote sandbox |
| Git-backed skill | The PagerPilot runbook is mounted from an immutable repository revision |
| Code Mode | Diagnostics can orchestrate awaited MCP calls inside the harness |
| Large-response offload | Oversized evidence is persisted outside the model context and retrieved intentionally |
| Saved reusable agent | `pagerpilot-incident-responder` is registered once and reused by UI, SDK, and terminal trigger |
| SDK automation | The trigger and replay pipeline create and drive real sessions programmatically |
| Embedded UI | The native TrueForge workbench exists as a separate operator route, not the product surface |

## Safety model

```text
READS                         HUMAN CHECKPOINTS                     WRITES
incident/logs/metrics  ──▶  remediation selection  ──▶  exact tool approval
source/deploy history       (not an execution grant)       │
                                                           ▼
                                                isolated preparation
                                                           │
                                                durable pre-push checkpoint
                                                           │
                                                           ▼
                                                  push + remote verify
```

Key constraints:

- No destructive action runs without native TrueForge approval.
- Slack delivery is approval-gated separately from rollback.
- A rollback in progress blocks incident resolution.
- SQLite transactions reserve one active remediation and prevent concurrent mutation.
- A restart compares remote HEAD with the approved deploy and persisted revert; any unrelated SHA becomes a conflict.
- Errors remain visible; the system does not turn missing evidence into success.


## How a run works

1. **Alert.** `demo/trigger-alert.sh` asks the operator control server to open a durable TrueForge session for incident `INC-4821` and posts "investigation started" to Slack.
2. **Acknowledge.** The saved `pagerpilot-incident-responder` agent loads the PagerPilot runbook skill, reads the incident from the `checkout-svc-sim` MCP server, and acknowledges the page.
3. **Investigate in parallel.** Four sibling subagents (logs, metrics, deploys, code) each return one typed JSON report. Missing evidence or unresolved unknowns block correlation.
4. **Correlate and decide.** The agent renders the RCA through OpenUI, posts the checkpoint to Slack, and pauses with an ask-user question for the remediation path.
5. **Approve.** Choosing rollback is not permission to act. `rollback_execute` pauses again on a native TrueForge approval for the exact repository and branch.
6. **Recover.** After approval, a Daytona sandbox clones the demo service, reproduces the regression, creates and tests the revert, pushes it, verifies the remote SHA, and stops.
7. **Close out.** The agent posts the final RCA to Slack, files a Linear follow-up in the `PagerPilot` team, and resolves the incident.

The operator command center (`http://127.0.0.1:4173`) renders this flow from session events. Its rollback and approval buttons play a staged recovery walkthrough for presentations; a real rollback runs when the `rollback_execute` approval is granted in the native TrueForge workbench.

## Run it locally

### Prerequisites

- Node.js 22.14 or later, with pnpm enabled once through `corepack enable pnpm`
- A [TrueForge](https://github.com/truefoundry/trueforge) checkout, run in standalone (SQLite) mode
- An OpenAI API key
- A Daytona API key with sandbox access and snapshot create permission
- A Linear workspace with a team named `PagerPilot`
- A Slack app with a bot token (`chat:write`, `chat:write.customize`) invited to your incident channel
- A GitHub fine-grained token with **Contents: read and write** on [`pagerpilot-demo`](https://github.com/hharshhsaini/pagerpilot-demo), the rollback target

### 1. Install PagerPilot

```bash
git clone --recurse-submodules https://github.com/hharshhsaini/pagerpilot.git
cd pagerpilot
pnpm install
cp .env.example .env
```

### 2. Start TrueForge

In the TrueForge checkout, create `packages/trueforge/.env`:

```bash
PORT=8790
HOST=127.0.0.1
APP_DATA_DIR_SUFFIX=dev
# Callback origin for Linear OAuth; the TrueForge UI serves /api on this origin
PUBLIC_BASE_URL=http://localhost:3000
# Allow the local checkout-svc-sim MCP server; all other private hosts stay blocked
OUTBOUND_URL_ALLOWED_HOSTS=["127.0.0.1"]
# A Daytona rollback can outlast the default 4-minute MCP request limit
MCP_REQUEST_TIMEOUT_MS=900000
```

Then start it and open the UI at `http://localhost:3000`:

```bash
pnpm install
pnpm standalone:dev
```

### 3. Connect providers in TrueForge

In **Settings**:

- **Models:** add OpenAI with your API key and no custom endpoint. Use the listed name, such as `openai/gpt-5-6-sol`, for `TRUEFORGE_MODEL`.
- **Sandbox providers:** add Daytona with your API key. TrueForge builds a `trueforge-build-…` snapshot in your Daytona account; put its name in `DAYTONA_SNAPSHOT`.
- **Connectors:** add Linear and complete OAuth.

### 4. Fill in `.env`

| Variable | Value |
|---|---|
| `TRUEFORGE_MODEL` | The model name TrueForge lists |
| `PAGERPILOT_SKILL_REPOSITORY_REF` | A pushed, full 40-character commit SHA that contains `skills/pagerpilot-runbook` (`git rev-parse HEAD`) |
| `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT` | Daytona key and the TrueForge-built snapshot |
| `GITHUB_DEMO_TOKEN` | Token with push access to `pagerpilot-demo` |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | Bot token (`xoxb-…`) and channel ID (`C…`) |
| `VITE_PAGERPILOT_AGENT_ID` | Filled in after step 5 |

Keep `.env` out of Git; `.env.example` must stay free of real values.

### 5. Start the MCP server and register the agent

```bash
cd mcp-servers/checkout-svc-sim
npx tsx --env-file=../../.env src/main.ts
```

In a second terminal, from the repository root:

```bash
node --env-file=.env scripts/bootstrap-trueforge.mjs
```

The bootstrap verifies the published runbook, model, MCP tools, and Linear connector, then creates or updates the saved agent. Copy the printed `agent.id` into `VITE_PAGERPILOT_AGENT_ID`.

### 6. Start the operator console

```bash
cd apps/operator
node --env-file=../../.env node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173`. It shows the healthy production monitor.

### 7. Fire an alert

```bash
PAGERPILOT_OPERATOR_URL=http://127.0.0.1:4173 ./demo/trigger-alert.sh INC-4821
```

The monitor turns red and opens the incident command center after a few seconds.

### Reset between runs

```bash
curl -X POST http://127.0.0.1:4173/demo/reset
```

Then stop the MCP server, delete its simulator state (`rm -f mcp-servers/checkout-svc-sim/.pagerpilot/checkout-svc-sim.sqlite*`), and start it again so `INC-4821` returns to `triggered`. After a real rollback, also move `pagerpilot-demo` `main` back to the deploy 9921 commit.

### Verify

```bash
pnpm verify
```
