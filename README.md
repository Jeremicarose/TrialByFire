# TrialByFire

**Subjective prediction markets resolved by adversarial AI debate, scored against transparent rubrics, settled trustlessly onchain.**

Traditional prediction markets can only resolve objective questions ("What will the price be?"). TrialByFire resolves *subjective* questions — "Did ETH staking yields consistently exceed 4%?", "Was the policy effective?", "Did quality improve?" — using an adversarial trial system where AI advocates debate with real evidence and an impartial judge scores both sides.

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  1. FILE     │     │  2. ADVERSARIAL  │     │  3. ONCHAIN     │
│  A CASE      │ ──► │  TRIAL           │ ──► │  SETTLEMENT     │
│              │     │                  │     │                 │
│ Create market│     │ YES advocate     │     │ Margin > thresh │
│ Set rubric   │     │ NO advocate      │     │  → RESOLVE      │
│ Stake ETH    │     │ Judge scores     │     │ Margin < thresh │
│              │     │ Hallucination    │     │  → ESCALATE     │
│              │     │ detection        │     │ Winners paid    │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

1. **File a Case** — Anyone creates a market with a question, rubric criteria, and deadline. Participants stake ETH on YES or NO.
2. **Adversarial Trial** — Two AI advocates (one arguing YES, one arguing NO) debate using real evidence from DeFiLlama, US Treasury, and other sources. A judge scores each argument against the rubric criteria. Hallucinated citations are detected and penalized.
3. **Onchain Settlement** — If the score margin exceeds the confidence threshold, the market auto-resolves and winners claim proportional payouts from the pool. If the AI isn't confident enough, stakes are refunded.

## Chainlink Integrations

TrialByFire uses **three Chainlink technologies**:

| Technology | Role | Implementation |
|---|---|---|
| **Chainlink Functions** | Runs the adversarial trial on the decentralized oracle network (DON) | Contract sends JS source to DON nodes → nodes execute trial → result returned via `fulfillRequest()` callback |
| **Chainlink Automation** | Auto-triggers settlement when market deadline passes | `checkUpkeep()` scans for expired markets → `performUpkeep()` calls `requestSettlement()` — no human intervention needed |
| **Chainlink Data Feeds** | Provides verified ETH/USD price as trusted evidence and UI display | `AggregatorV3Interface` reads from Chainlink's Sepolia price feed |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React)                  │
│  MarketList → MarketView → TrialTranscript          │
│  JudgeScorecard → SettlementStatus                  │
│  useWallet (MetaMask) + useContract (ethers.js)     │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
┌─────────────┐ ┌───────────┐ ┌──────────────┐
│  SMART      │ │  ENGINE   │ │  CHAINLINK   │
│  CONTRACT   │ │  (Trial   │ │  DON         │
│             │ │  Pipeline)│ │              │
│ TrialMarket │ │           │ │  Functions   │
│ .sol        │ │ Evidence  │ │  Automation  │
│             │ │ Advocates │ │  Data Feeds  │
│ Sepolia     │ │ Judge     │ │              │
└─────────────┘ └───────────┘ └──────────────┘
```

**Monorepo packages:**
- `packages/contracts` — Solidity smart contract with Chainlink integrations (805 lines)
- `packages/engine` — Trial pipeline: evidence gathering, adversarial advocates, judge scoring, confidence evaluation
- `packages/frontend` — React dashboard with wallet connection, staking, and live trial display

## Deployed Contract

- **Network:** Sepolia Testnet
- **Contract:** [`0xb29D782f83605E9E8f0B08a17268Db3AfCc006c4`](https://sepolia.etherscan.io/address/0xb29D782f83605E9E8f0B08a17268Db3AfCc006c4)
- **Chainlink Subscription:** #6306 (10 LINK funded)

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/TrialByFire.git
cd TrialByFire
npm install

# Set up environment
cp .env.example .env
# Fill in API keys (ANTHROPIC_API_KEY or OPENAI_API_KEY)

# Run contract tests (43 tests)
npx hardhat test --config packages/contracts/hardhat.config.ts

# Start the trial API server
npm run api -w packages/engine

# Start the frontend (in another terminal)
npm run dev -w packages/frontend
# Open http://localhost:5173
```

## The Trial Pipeline

Each trial runs through this pipeline:

1. **Evidence Gathering** — Fetches real data from DeFiLlama (DeFi yields, TVL), US Treasury (interest rates), and other APIs
2. **YES Advocate** — AI argues in favor of the claim, citing specific evidence
3. **NO Advocate** — AI argues against the claim, citing specific evidence (runs in parallel with YES)
4. **Judge Scoring** — Impartial AI scores each advocate's arguments per rubric criterion (data accuracy, time period coverage, source diversity, logical coherence)
5. **Hallucination Detection** — Judge flags any citations that don't match the evidence bundle
6. **Confidence Evaluation** — If score margin exceeds threshold AND no hallucinations detected → RESOLVE. Otherwise → ESCALATE (refund all stakers)

## Tech Stack

- **Smart Contract:** Solidity, Hardhat, OpenZeppelin, Chainlink Contracts
- **Engine:** TypeScript, Anthropic Claude / OpenAI GPT-4o, DeFiLlama API, US Treasury API
- **Frontend:** React, TypeScript, Vite, ethers.js v6
- **Blockchain:** Ethereum Sepolia, Chainlink Functions / Automation / Data Feeds

## What Makes This Novel

1. **Subjective resolution** — No oracle can answer "Did quality improve?" TrialByFire uses adversarial debate to resolve questions that traditional prediction markets cannot.
2. **Adversarial structure prevents bias** — Two separate AI models argue opposing sides. Neither can collude. The judge must justify scores against objective criteria.
3. **Hallucination safety** — If the AI fabricates evidence, it's caught and the market escalates (refunds everyone) instead of settling incorrectly.
4. **Transparent reasoning** — Every trial produces a full transcript: evidence cited, arguments made, scores given, reasoning explained. Nothing is a black box.
5. **Decentralized execution** — Chainlink Functions runs the trial on the DON, not a centralized server. Chainlink Automation triggers settlement without human intervention.

---

Built for the Chainlink Convergence Hackathon.
