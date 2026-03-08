# TrialByFire

**Subjective prediction markets resolved by adversarial AI debate, powered by Chainlink CRE (Chainlink Runtime Environment).**

Traditional prediction markets can only resolve objective questions ("What will the price be?"). TrialByFire resolves *subjective* questions — "Is AI-generated art real art?", "Should social media platforms be liable for user content?", "Did ETH staking yields consistently exceed 4%?" — using an adversarial trial system where AI advocates debate and an impartial judge delivers a verdict, all orchestrated by a CRE workflow running on Chainlink's Decentralized Oracle Network.

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  1. FILE     │     │  2. ADVERSARIAL  │     │  3. ONCHAIN     │
│  A CASE      │ ──► │  TRIAL (CRE)     │ ──► │  SETTLEMENT     │
│              │     │                  │     │                 │
│ Create market│     │ CRE Log Trigger  │     │ KeystoneForwarder│
│ Set rubric   │     │ Anthropic AI     │     │  → onReport()   │
│ Stake ETH    │     │ DON consensus    │     │  → RESOLVE      │
│              │     │ Signed report    │     │ Winners paid    │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

1. **File a Case** — Anyone creates a market with a subjective question and a deadline. Participants stake ETH on YES or NO.
2. **Adversarial Trial via CRE** — When the deadline passes, a `SettlementRequested` event fires. The CRE workflow catches this via Log Trigger, runs a condensed adversarial trial through Anthropic's Claude API, and DON nodes reach consensus on the verdict.
3. **Onchain Settlement** — The CRE workflow writes a cryptographically signed report through the KeystoneForwarder to the contract's `onReport()` function. The market resolves and winners claim proportional payouts.

## CRE Workflow Architecture

TrialByFire uses **Chainlink CRE** as the core orchestration layer — a single TypeScript workflow that replaces separate Functions + Automation integrations:

```
  SettlementRequested event (on-chain)
           │
           ▼
  ┌─────────────────────────────────┐
  │  CRE WORKFLOW (packages/workflow)│
  │                                  │
  │  1. Log Trigger catches event    │
  │  2. Decode marketId + question   │
  │  3. Call Anthropic Claude API    │
  │     (condensed adversarial trial)│
  │  4. DON nodes reach consensus    │
  │  5. Write signed report          │
  └──────────────┬──────────────────┘
                 │
                 ▼
  KeystoneForwarder (0x15fc...f9f88)
                 │
                 ▼
  TrialMarket.onReport() → _processReport() → Market Resolved
```

**Why CRE?** Instead of running separate Chainlink services (Functions for compute, Automation for scheduling), CRE unifies everything into one workflow. Multiple DON nodes independently execute the trial and agree on the result — no centralized server needed.

### CRE Workflow Files

| File | Purpose |
|---|---|
| `packages/workflow/main.ts` | Entry point — registers Log Trigger on `SettlementRequested` events |
| `packages/workflow/logCallback.ts` | Settlement handler: decode event → call AI → write signed report |
| `packages/workflow/trial.ts` | Anthropic API integration with `consensusIdenticalAggregation` |
| `packages/workflow/workflow.yaml` | CRE workflow settings |
| `packages/workflow/config.staging.json` | Contract address + model config |

## Additional Chainlink Integrations

| Technology | Role |
|---|---|
| **Chainlink Data Feeds** | Provides verified ETH/USD price as trusted evidence and UI display via `AggregatorV3Interface` |
| **Chainlink Functions** | Legacy integration — contract retains `sendTrialRequest()` / `_fulfillRequest()` for fallback |
| **Chainlink Automation** | Auto-triggers `requestSettlement()` when market deadlines pass via `checkUpkeep()` / `performUpkeep()` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                        │
│  MarketList → MarketView → Outcome Banners (Win/Loss/Refund)│
│  ParticipantList → TrialTranscript → JudgeScorecard         │
│  useWallet (Rabby/MetaMask) + useContract (ethers.js)       │
└──────────────────────────┬──────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
│  SMART        │ │  CRE         │ │  ENGINE          │
│  CONTRACT     │ │  WORKFLOW    │ │  (Local Fallback)│
│               │ │              │ │                  │
│ TrialMarket   │ │ Log Trigger  │ │ Evidence sources │
│ .sol          │ │ Anthropic AI │ │ Adversarial      │
│               │ │ DON Consensus│ │ advocates + judge│
│ onReport()    │ │ writeReport  │ │ IPFS transcripts │
│ Sepolia       │ │              │ │                  │
└───────────────┘ └──────────────┘ └──────────────────┘
```

**Monorepo packages:**
- `packages/contracts` — Solidity smart contract with CRE `onReport()`, Chainlink Functions/Automation/Data Feeds
- `packages/workflow` — CRE TypeScript workflow: Log Trigger → Anthropic AI trial → signed report
- `packages/engine` — Local trial pipeline fallback: evidence gathering, adversarial advocates, judge scoring
- `packages/frontend` — React dashboard with wallet connection, staking, outcome display

## Deployed Contract

- **Network:** Sepolia Testnet
- **Contract:** [`0xE2267395BC6DCF097c77eeCaB6F13b9A5569B0A5`](https://sepolia.etherscan.io/address/0xE2267395BC6DCF097c77eeCaB6F13b9A5569B0A5)
- **KeystoneForwarder:** `0x15fc6ae953e024d975e77382eeec56a9101f9f88`
- **Chainlink Subscription:** #6306

## Quick Start

```bash
# Clone and install
git clone https://github.com/Jeremicarose/TrialByFire.git
cd TrialByFire
npm install

# Set up environment
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, DEPLOYER_PRIVATE_KEY, SEPOLIA_RPC_URL

# Deploy to Sepolia
cd packages/contracts
npx hardhat run scripts/setup-sepolia.ts --network sepolia

# Activate Chainlink (upload encrypted secrets)
npx hardhat run scripts/activate-chainlink.ts --network sepolia

# Install CRE workflow deps
cd ../workflow
bun install

# Simulate CRE workflow
export PATH="$HOME/.cre/bin:$PATH"
cre workflow simulate . --target staging-settings

# Start local engine (fallback)
cd ../engine && npx tsx src/api.ts

# Start frontend
cd ../frontend && npx vite --host
# Open http://localhost:5173
```

## CRE Workflow Simulation

The CRE workflow has been tested end-to-end:

```
$ cre workflow simulate . --target staging-settings --trigger-index 0 \
    --evm-tx-hash 0x1c9fe7... --evm-event-index 0 --non-interactive

[SIMULATION] Running trigger evm:ChainSelector:16015286601757825753@1.0.0
[USER LOG] TrialByFire CRE Workflow: Settlement Trial
[USER LOG] [Step 1] Settlement requested for Market #0
[USER LOG] [Step 1] Question: "Will ETH be above $2000 on March 10, 2026?"
[USER LOG] [Step 2] Running adversarial trial via Anthropic...
[USER LOG] [Step 2] Verdict: YES, Confidence: 65%
[USER LOG] [Step 3] Writing to contract: 0xE2267395BC6DCF097c77eeCaB6F13b9A5569B0A5
[USER LOG] [Step 3] Settlement successful

✓ Workflow Simulation Result: "Settled Market #0"
```

## The Trial Pipeline

Each adversarial trial evaluates a question through structured debate:

1. **CRE Log Trigger** — Catches `SettlementRequested(marketId, question)` event from the contract
2. **Anthropic AI Trial** — A single condensed prompt runs the full adversarial process: argue YES, argue NO, judge both sides, return verdict with confidence score
3. **DON Consensus** — Multiple Chainlink nodes independently execute the trial and agree on identical results via `consensusIdenticalAggregation`
4. **Signed Report** — The agreed result is encoded (prefix `0x01` + marketId + outcome + confidence) and written to the contract via KeystoneForwarder

### Local Fallback Pipeline (Engine)
For development, the engine runs a more detailed pipeline:
- Evidence gathering from DeFiLlama, US Treasury, and dynamic API sources
- Parallel YES/NO advocate debate using Claude
- Judge scoring against rubric criteria
- Hallucination detection
- Confidence threshold evaluation
- IPFS transcript storage via Pinata

## Tech Stack

- **Smart Contract:** Solidity 0.8.24, Hardhat, OpenZeppelin, Chainlink Contracts
- **CRE Workflow:** TypeScript, `@chainlink/cre-sdk`, Anthropic Claude API
- **Engine:** TypeScript, Anthropic Claude, DeFiLlama API, US Treasury API, Pinata IPFS
- **Frontend:** React, TypeScript, Vite, ethers.js v6
- **Blockchain:** Ethereum Sepolia, Chainlink CRE / Functions / Automation / Data Feeds

## What Makes This Novel

1. **CRE-native architecture** — Uses Chainlink Runtime Environment as the primary settlement path. A single TypeScript workflow orchestrates the entire trial-to-settlement pipeline on the DON.
2. **Subjective resolution** — No oracle can answer "Is AI art real art?" TrialByFire uses adversarial debate to resolve questions traditional prediction markets cannot.
3. **Decentralized AI adjudication** — Multiple DON nodes independently run the AI trial and reach consensus. No single server or operator controls the outcome.
4. **Cryptographic settlement** — Results are delivered via KeystoneForwarder with signed reports. The contract verifies the source before accepting any settlement.
5. **Adversarial structure prevents bias** — The trial prompt forces consideration of both YES and NO perspectives before rendering judgment.
6. **Safe defaults** — If confidence is too low or the trial fails, markets escalate and all stakers receive full refunds.

---

Built for the Chainlink Convergence Hackathon 2026.
