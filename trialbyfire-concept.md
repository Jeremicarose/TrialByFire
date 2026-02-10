# HACKATHON CONCEPT: CONVERGENCE
# Revised — Adversarial Resolution Architecture

---

## PRE-FLIGHT VALIDATION CHECKLIST

| Constraint | Status | Evidence |
|-----------|--------|----------|
| NOT in Eliminated Zones | ☑ PASS | Not a basic prediction market with price resolution (Polymarket solved that). This is adversarial *subjective* resolution — a fundamentally different mechanism. |
| IN Validated Gaps | ☑ PASS | Maps to "Subjective prediction market resolution" — ranked #2 validated gap in Ground Truth, #3 in Synthesis. Also maps to "AI guardrails/verification" (#1 gap) via the adversarial verification mechanism. |
| Uses ONLY Available Tech | ☑ PASS | CRE SDK (TS), HTTP Client, EVM Client, EVM Log Trigger, Cron Trigger, Data Feeds, Sepolia — all ✅ confirmed self-serve |
| Aligns with Winning Patterns | ☑ PASS | Multi-service stack (5+ CRE capabilities), autonomous workflow, "real money" narrative (prediction markets are $B market), live state change, new capability showcase |
| Avoids Anti-Patterns | ☑ PASS | Not an oracle wrapper, not AI-advisor-only (AI agents execute adversarial debate AND settlement), not rebuilding a sponsor product (Polymarket partnership only does deterministic resolution) |
| Targets highest-probability Opportunity | ☑ PASS | Eligible for BOTH Prediction Markets ($16K) AND CRE & AI ($17K) — can submit to whichever has less competition |

---

## CONCEPT

**NAME**

# TrialByFire

**ONE-SENTENCE VALUE PROP**
An adversarial AI debate protocol built on CRE that resolves subjective prediction markets by pitting two AI agents against each other — one argues YES, one argues NO, each citing real evidence — while a CRE workflow scores the debate, settles the market, and writes the full trial transcript onchain as an immutable audit trail.

**TARGET TRACK**
- **Primary**: Prediction Markets — $10K (1st) / $6K (2nd)
- **Secondary**: CRE & AI — $10.5K (1st) / $6.5K (2nd)
- **Safety net**: Top 10 Projects ($1.5K × 10)

---

## PROBLEM

**Who feels this pain?**

- **Primary: Prediction market platforms (Polymarket, Kalshi, Gnosis)** — They can only list markets with deterministic, machine-verifiable outcomes (price above X, team wins game). Subjective markets ("Did Company X meet its climate pledge?", "Was the product launch successful?", "Did the policy improve public sentiment?") cannot be reliably resolved. This eliminates ~80% of the most interesting and valuable markets.

- **Secondary: Market participants / traders** — They want to bet on real-world subjective outcomes but can't because resolution mechanisms are either centralized (single oracle operator decides), slow (dispute committees take weeks), or nonexistent.

**How often?**
- Every market settlement for subjective outcomes — potentially thousands of markets per day at scale. Currently these markets simply don't exist because there's no resolution mechanism.

**Current workaround?**
- **Centralized oracle committees**: Polymarket uses UMA's optimistic oracle with human dispute resolution. Slow (days-weeks), expensive, and vulnerable to manipulation via vote buying.
- **Single-AI resolution**: Emerging approach where one LLM reads evidence and returns a verdict. Vulnerable to model bias, hallucination, and single point of failure.
- **Avoid subjective markets entirely**: Most platforms simply don't list them. The market opportunity is forgone.

**Why workaround fails?**
- **Committee resolution** doesn't scale: each market needs human attention, disputes are costly, and the committee itself can be captured (UMA token holders voting on outcomes they bet on)
- **Single-AI resolution** is the "self-policing agent" problem: the same model that interprets the evidence also decides the outcome. Research shows single-agent accuracy on controversial claims is significantly lower than adversarial debate (DebateCV: 2.6-5.8% improvement; Khan et al. 2024: non-experts judge debates more accurately than single-model outputs)
- **Avoiding subjective markets** leaves billions in potential trading volume on the table

**The core insight:** The legal system solved subjective dispute resolution centuries ago — not by asking one judge to decide alone, but by requiring adversarial trial: prosecution vs. defense, each forced to present their best evidence, with a neutral adjudicator scoring the arguments. TrialByFire brings this model onchain via CRE, where the "trial" runs across a decentralized oracle network with BFT consensus.

---

## SOLUTION

**Step-by-step workflow:**

### Phase 1: Market Creation (Pre-CRE)
A market creator deploys a `TrialMarket` contract on Sepolia with:
- The subjective question (e.g., "Did the EU AI Act implementation improve industry compliance by Q1 2026?")
- A resolution rubric (structured criteria: what counts as evidence, what weight each criterion carries)
- A settlement deadline
- Collateral pool from market participants

### Phase 2: Settlement Triggered (CRE Entry Point)

**Step 1 — TRIGGER**: Settlement deadline passes. A Cron Trigger fires the TrialByFire CRE workflow. (Alternatively: market creator calls `requestSettlement()` which emits an EVM Log event.)

**Step 2 — EVIDENCE GATHERING**: CRE HTTP Client fetches evidence from multiple external sources in parallel:
- News APIs (e.g., NewsAPI, Google News RSS)
- Data APIs (e.g., DeFiLlama for onchain metrics, public government data APIs)
- Social sentiment APIs (e.g., Reddit API, Twitter/X search)
- Domain-specific APIs relevant to the market question

All raw evidence is aggregated into an evidence bundle.

**Step 3 — ADVERSARIAL DEBATE**: CRE HTTP Client makes TWO parallel LLM API calls:

- **Advocate YES** (HTTP POST → Claude/OpenAI API): Receives the market question, the resolution rubric, and the evidence bundle. System prompt: "You are the advocate arguing that the answer is YES. Build the strongest possible case using ONLY the provided evidence. You must cite specific evidence for every claim. Structure your argument to address each rubric criterion."

- **Advocate NO** (HTTP POST → Claude/OpenAI API): Same evidence bundle, same rubric. System prompt: "You are the advocate arguing that the answer is NO. Build the strongest possible case using ONLY the provided evidence. You must cite specific evidence for every claim. Structure your argument to address each rubric criterion."

Both return structured JSON: `{ verdict: YES/NO, confidence: 0-100, arguments: [{criterion, claim, evidence_citation, strength}], weaknesses_in_opposing_case: [...] }`

**Step 4 — ADJUDICATION**: CRE HTTP Client makes a THIRD LLM API call:

- **Judge** (HTTP POST → LLM API, preferably a different model than the advocates): Receives the market question, rubric, evidence bundle, AND both advocate arguments. System prompt: "You are a neutral adjudicator. Score each argument against the rubric criteria. Identify which advocate's claims are better supported by the evidence. Flag any hallucinated citations. Return your verdict, a per-criterion scorecard, and a written ruling."

Returns: `{ final_verdict: YES/NO, score_yes: 0-100, score_no: 0-100, per_criterion_scores: [...], ruling_text: "...", hallucinations_detected: [...] }`

**Step 5 — CONFIDENCE CHECK & DECISION**:
The CRE workflow evaluates the Judge's output:
- If `score_yes - score_no > threshold` (e.g., 20 points) → **RESOLVE** the market with the winning verdict
- If margin is too close → **ESCALATE** (emit `DisputeRequired` event for human/DAO jury)
- If `hallucinations_detected` is non-empty → **FLAG** and reduce confidence

**Step 6 — SETTLEMENT**: 
- **RESOLVED** → CRE EVM Client calls `TrialMarket.settle(verdict, trialTranscript)` which:
  - Distributes collateral to winning positions
  - Stores the full trial transcript hash onchain (actual transcript stored on IPFS or as calldata)
  - Emits `MarketResolved(verdict, scoreYes, scoreNo, transcriptHash)` event
- **ESCALATED** → CRE EVM Client calls `TrialMarket.escalate(trialTranscript)` which:
  - Pauses settlement
  - Makes the full adversarial transcript available for human review
  - Opens a dispute window

**Architecture Diagram:**

```
    ┌────────────────────────────────────────────────────────────────────┐
    │                     TRIALBYFIRE CRE WORKFLOW                      │
    │                                                                    │
    │  ┌─────────────┐         ┌──────────────────────────────────┐     │
    │  │ Cron Trigger │────────▶│  Step 2: EVIDENCE GATHERING      │     │
    │  │ (deadline)   │         │                                  │     │
    │  └─────────────┘         │  HTTP Client → News API     ─┐   │     │
    │        OR                │  HTTP Client → Data API      │   │     │
    │  ┌─────────────┐         │  HTTP Client → Sentiment API ─┤   │     │
    │  │ EVM Log     │         │  EVM Client  → Onchain data  ─┘   │     │
    │  │ Trigger     │         │         (all in parallel)         │     │
    │  └─────────────┘         └───────────────┬──────────────────┘     │
    │                                          │                        │
    │                                   Evidence Bundle                 │
    │                                          │                        │
    │                          ┌───────────────┼───────────────┐        │
    │                          ▼                               ▼        │
    │               ┌──────────────────┐            ┌──────────────────┐│
    │               │  ADVOCATE YES    │            │  ADVOCATE NO     ││
    │               │  HTTP → LLM API  │            │  HTTP → LLM API  ││
    │               │                  │            │                  ││
    │               │ "Build strongest │            │ "Build strongest ││
    │               │  case for YES    │            │  case for NO     ││
    │               │  using evidence" │            │  using evidence" ││
    │               └────────┬─────────┘            └────────┬─────────┘│
    │                        │                               │          │
    │                        └───────────┬───────────────────┘          │
    │                                    │                              │
    │                                    ▼                              │
    │                         ┌──────────────────┐                      │
    │                         │     JUDGE         │                      │
    │                         │  HTTP → LLM API   │                      │
    │                         │  (different model) │                      │
    │                         │                    │                      │
    │                         │ Scores both args   │                      │
    │                         │ against rubric     │                      │
    │                         │ Flags hallucinations│                     │
    │                         │ Returns verdict    │                      │
    │                         └────────┬───────────┘                      │
    │                                  │                                │
    │                         ┌────────┴────────┐                       │
    │                         │ CONFIDENCE CHECK │                       │
    │                         └────────┬────────┘                       │
    │                    ┌─────────────┼─────────────┐                  │
    │                    ▼             ▼             ▼                  │
    │              Clear Winner    Too Close     Hallucinations          │
    │                    │             │             │                  │
    │              EVM Write      EVM Write      EVM Write             │
    │             settle()       escalate()     escalate()             │
    │                    │             │             │                  │
    └────────────────────┼─────────────┼─────────────┼──────────────────┘
                         ▼             ▼             ▼
                  ┌─────────────────────────────────────────┐
                  │         TRIALMARKET.SOL (Sepolia)        │
                  │                                         │
                  │  Resolved → distribute to winners       │
                  │  Escalated → open dispute window        │
                  │  Trial transcript hash stored onchain   │
                  └─────────────────────────────────────────┘
```

---

## TECH STACK

| Layer | Component | Purpose | Availability Verified? |
|-------|-----------|---------|----------------------|
| **Orchestration** | CRE TypeScript SDK (`@chainlink/cre-sdk` v1.0.7) | Workflow definition, handler registration, promise pipelining for parallel calls | ✅ Confirmed — npm package, self-serve |
| **Orchestration** | CRE CLI (`cre workflow simulate`) | Compile WASM, run simulation with real API calls + real chain interactions | ✅ Confirmed — free, no approval needed |
| **Trigger** | CRE Cron Trigger | Fires workflow at market settlement deadline | ✅ Confirmed — documented in SDK |
| **Trigger (alt)** | CRE EVM Log Trigger | Fires on `SettlementRequested` event from contract | ✅ Confirmed — documented in SDK |
| **Capability** | CRE HTTP Client (×5+) | Evidence gathering (news, data, sentiment APIs) + 3 LLM calls (2 advocates + 1 judge) | ✅ Confirmed — `HTTPClient`, any REST endpoint |
| **Capability** | CRE EVM Client (Read) | Read market state, parameters, rubric from contract | ✅ Confirmed — `EVMClient` in SDK |
| **Capability** | CRE EVM Client (Write) | Settle market or escalate dispute + store transcript hash | ✅ Confirmed — writes through Forwarder contract |
| **Sponsor** | Chainlink Data Feeds | Cross-reference any onchain price/data evidence cited by advocates | ✅ Confirmed — production, Sepolia |
| **On-chain** | TrialMarket.sol (Solidity) | Market contract: positions, collateral escrow, settlement, dispute, transcript storage | ✅ Standard Solidity → Sepolia |
| **On-chain** | Sepolia testnet | All chain interactions | ✅ Free ETH at faucets.chain.link |
| **External API** | NewsAPI / Google News RSS | Evidence source: news articles for advocate citations | ✅ Public, free tier available |
| **External API** | DeFiLlama API | Evidence source: onchain/DeFi metrics | ✅ Public, free, no key needed |
| **AI** | Claude API (Advocate YES + Judge) | Structured argumentation + adjudication | ✅ Public API |
| **AI** | OpenAI API (Advocate NO) | Adversarial counter-argument (different model = genuine diversity) | ✅ Public API |
| **Frontend** | React dashboard | Market view, live debate transcript, verdict visualization | ✅ Standard web tech |

**All components: ✅ — zero gated/uncertain dependencies in the critical path.**

**CRE Capability Count: 8+** (Cron Trigger, EVM Log Trigger, HTTP Client ×5, EVM Read, EVM Write, Data Feeds reference)
This is significantly deeper than the typical hackathon project (3 services) and deeper than the Chromion GP winner YieldCoin (3 services).

---

## DEMO FLOW

**Total time: 4 minutes 30 seconds**

| Timestamp | What's Shown | What Judge Sees | Wow Moment? |
|-----------|--------------|-----------------|-------------|
| 0:00–0:30 | **Problem framing**: "Prediction markets can only resolve questions a machine can verify — price above X, team wins. The most valuable questions are subjective: Did the policy work? Was the product launch successful? Did they meet their commitment? These markets can't exist today because there's no trusted resolution mechanism." | Clear, urgent problem. Dollar value of the untapped market. | |
| 0:30–0:55 | **Architecture**: 20-second diagram animation. "TrialByFire doesn't ask one AI to decide. It runs a trial. Two adversarial AI advocates argue the case — one for YES, one for NO — forced to cite real evidence. A third AI judge scores the arguments against a transparent rubric. The entire trial runs as a CRE workflow across a DON." | "Oh — this is an adversarial protocol, not just another AI oracle" | |
| 0:55–1:20 | **Market setup**: Show the TrialMarket contract on Sepolia. The question: "Did ETH staking yields consistently outperform US Treasury rates in January 2026?" Show the rubric (data sources, criteria, weights). Show positions taken (YES pool: 500 USDC, NO pool: 300 USDC). | Concrete, verifiable example. Real money at stake. | |
| 1:20–2:15 | **Live CRE Simulation — THE TRIAL**: Run `cre workflow simulate`. Terminal shows: (1) Cron trigger fires → (2) HTTP calls fetching evidence from DeFiLlama + news APIs → (3) TWO parallel LLM calls executing — Advocate YES builds case, Advocate NO builds counter-case → (4) Judge LLM receives both arguments → (5) Judge returns scorecard. The full debate transcript streams in the terminal. | ⭐ **PRIMARY WOW MOMENT at ~2:00** — watching the two AI advocates argue in real-time with cited evidence, then the judge scoring them. The CRE simulation log shows every capability call, every HTTP round-trip, the full debate. This is unlike anything judges have seen. |
| 2:15–2:45 | **The Verdict**: Judge scores YES: 78, NO: 45. Margin > threshold → RESOLVE. CRE EVM Write calls `settle(YES, transcriptHash)`. Show the Etherscan tx: market settled, YES position holders receive payout, transcript hash stored onchain. | Live state change. Funds actually move. Immutable record. | ⭐ |
| 2:45–3:15 | **The Escalation Path**: Show a second scenario where the judge scores are close (YES: 52, NO: 48). CRE workflow detects thin margin → calls `escalate()` instead. Show the full adversarial transcript becoming available for human review. "When AI isn't confident, it doesn't guess — it escalates with all the evidence already organized." | Safety mechanism visible. Not blind trust in AI. | |
| 3:15–3:50 | **Dashboard**: React UI showing — the trial transcript with both advocate arguments side-by-side, the judge's per-criterion scorecard, market positions and payouts, confidence visualization. Operator can adjust the threshold for escalation. | Product-level polish. "I would use this." | |
| 3:50–4:15 | **CRE Depth Walkthrough**: Quick code tour — `handler()` with Cron Trigger, parallel HTTP promises (evidence + 2 advocates), sequential Judge call, conditional branch (settle vs escalate), EVM write. Point to simulation log. "8+ CRE capability invocations, conditional branching, parallel execution — CRE isn't a checkbox, it's the entire system." | Judge confirms deep CRE usage | |
| 4:15–4:30 | **Close**: "Polymarket + Chainlink solved deterministic resolution. TrialByFire solves the rest. Every subjective question — politics, policy, ESG, product quality — can now become a market." Roadmap: multi-model diversity, CCIP for cross-chain markets, Confidential HTTP for private evidence, ACE for compliance. | Forward-looking, ties into Chainlink ecosystem | |

**Primary wow moment: ~2:00** (adversarial debate streaming in CRE simulation terminal)
**Secondary wow moment: ~2:40** (settlement tx on Etherscan with funds moving)

---

## WHY THIS WINS

### Winning Pattern Match

| Winning Pattern (from Synthesis) | How TrialByFire Matches |
|---------------------------------|--------------------------|
| **Multi-service Chainlink stack (3+ services)** | 8+ CRE capability invocations: Cron Trigger + EVM Log Trigger + HTTP Client ×5 (evidence APIs + 2 advocates + 1 judge) + EVM Read + EVM Write + Data Feeds. This is the deepest CRE usage any hackathon project will have. |
| **Autonomous multi-step workflow ("it runs itself")** | Zero human intervention from trigger to settlement. Market deadline → evidence gathering → adversarial debate → adjudication → confidence check → settle or escalate. The only human touchpoint is the escalation path, which is a *feature* not a limitation. |
| **"Real money would flow here" narrative** | Prediction markets are a proven billion-dollar market. Polymarket alone did $6B+ in 2024 volume. But subjective markets are the untapped 80%. Resolution is the only blocker — and TrialByFire removes it. |
| **Real-time demo with visible state change** | Two live Sepolia transactions: `settle()` with funds distribution + `escalate()` with dispute opening. CRE simulation log shows every HTTP call and the full adversarial debate. Etherscan verifiable. |
| **New Chainlink capability showcase** | First adversarial AI debate protocol on CRE. Uses TypeScript SDK, promise pipelining for parallel execution, conditional branching, multi-model AI diversity. Demonstrates CRE's unique advantage: the debate verification runs on a DON with BFT consensus, making the trial itself tamper-proof. |

### Sponsor Favoritism Match

| Sponsor Signal | How TrialByFire Demonstrates |
|----------------|------------------------------|
| **Deep CRE orchestration** | CRE is the nervous system: trigger → parallel evidence fetch → parallel adversarial debate → sequential adjudication → conditional settlement. The simulation log shows 8+ capability calls with real data flowing between them. |
| **Institutional narrative** | "Adversarial resolution for subjective markets" is directly applicable to dispute resolution in institutional finance (credit events, ESG claims, regulatory compliance determinations). Frame as: "bringing the trial system to onchain markets." |
| **New capability showcase** | Fills the exact gap Chainlink acknowledged: Polymarket partnership handles deterministic markets, TrialByFire handles everything else. This extends the sponsor's strategic position. |

### Differentiation from Known Patterns

| Competitor/Pattern | TrialByFire's Differentiation |
|-------------------|-------------------------------|
| **Single-AI resolution (documented CRE pattern)** | That pattern trusts one AI and cross-checks. TrialByFire trusts NO individual AI — the adversarial structure forces both sides to present their best case, and a separate judge evaluates. Research shows this is 2.6-5.8% more accurate (DebateCV, 2025). |
| **Polymarket + Chainlink (live)** | Handles only deterministic, price-based markets. TrialByFire handles the 80% of markets that are subjective. Complementary, not competitive. |
| **UMA Optimistic Oracle** | Requires human committee resolution (days-weeks). TrialByFire resolves in minutes via AI, with human escalation only for edge cases. |
| **Ava Protocol / Blockaid / ProverX** | Verify AI agents that *trade*. TrialByFire verifies AI agents that *judge*. Completely different problem domain. |

---

## RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **LLM API latency (3 sequential HTTP calls after evidence gathering)** | M | M | Advocates run in PARALLEL (not sequential). Only the Judge is sequential (needs both arguments). Total: evidence fetch ~3s + advocates ~5s (parallel) + judge ~5s = ~13s total. CRE simulation handles this natively. If any call times out (10s limit), use cached/truncated response. |
| **LLM advocates produce weak or biased arguments** | M | M | Use DIFFERENT models (Claude for YES, OpenAI for NO) to ensure genuine diversity. Structured JSON output format prevents rambling. Few-shot examples in the system prompt demonstrate expected argument quality. The adversarial structure itself mitigates bias — both sides are represented. |
| **Judge LLM favors one advocate due to model bias** | L | H | Use a THIRD model for the judge (e.g., Gemini or a different Claude model). Include explicit anti-bias instructions: "Score arguments solely on evidence quality and rubric alignment, not on your own beliefs." The confidence threshold + escalation path catches marginal cases. |
| **TypeScript SDK WASM quirks** | M | H | Follow `.result()` pattern exactly. No async/await — use promise pipelining. Test WASM compilation Day 1. Fallback: Go SDK is more mature. |
| **Evidence APIs return noisy or irrelevant data** | M | L | Pre-filter evidence with keyword matching before passing to advocates. Structure evidence by source type. The adversarial structure is inherently noise-tolerant — advocates select the most relevant evidence from the bundle; irrelevant data gets ignored. |
| **Demo market question is too complex for a clean demo** | L | M | Pre-select a market question with clear, verifiable data: "Did ETH staking yields outperform US Treasury rates in January 2026?" This has concrete data from DeFiLlama + Treasury.gov, making the evidence gathering and debate clearly grounded. |
| **Scope creep** | M | H | Hard scope: 1 CRE workflow, 1 Solidity contract, 1 React dashboard, 2 demo scenarios (resolve + escalate). NO CCIP, no multi-chain, no ACE, no token mechanics, no governance — all roadmap only. |

---

## SKEPTICAL JUDGE TEST

**Anticipated objection #1:** "Three LLM calls is expensive and slow. Why not just use one AI with cross-checking like the standard pattern?"

**Response:** Cost: three API calls is ~$0.15 per resolution at current pricing. For a market settling thousands of dollars in positions, this is negligible — less than 0.01% of market value. Speed: advocates run in parallel (~5s), judge is sequential (~5s), total ~13s end-to-end. That's faster than any human committee by orders of magnitude. Accuracy: the academic evidence is clear — adversarial debate outperforms single-agent verification by 2.6-5.8% (DebateCV, arxiv 2025) and significantly reduces harmful belief reversals (Khan et al., ICML 2024). For high-stakes market settlement, that accuracy improvement translates directly into money. You're spending $0.15 to correctly settle a $10,000 market.

**Anticipated objection #2:** "What if both advocates agree? Doesn't that break the adversarial structure?"

**Response:** If both advocates, instructed to argue opposite positions, converge on the same conclusion despite conflicting mandates — that's actually the *strongest possible signal* that the evidence overwhelmingly supports one side. The judge will score a very high margin, and the market resolves with maximum confidence. The adversarial structure doesn't require disagreement — it requires that both sides present their *best case*. When the best case for NO is weak even with an advocate trying hard, that's informative and reliable.

**Anticipated objection #3:** "The AI advocates might hallucinate citations. How do you trust the evidence?"

**Response:** Three safeguards. First, the evidence bundle is fetched by the CRE workflow from real APIs — the advocates can only cite evidence that actually exists in the bundle, not hallucinate external sources. Second, the judge's explicit task includes "flag any hallucinated citations" — checking advocate claims against the evidence bundle. Third, detected hallucinations trigger the escalation path rather than blind settlement. The architecture assumes AI is unreliable and builds safeguards around that assumption, rather than trusting any single model.

**Anticipated objection #4:** "This is just an AI wrapper. The CRE workflow is just piping data between APIs."

**Response:** Every CRE workflow pipes data between capabilities — that's what orchestration means. The question is whether the orchestration is *deep and non-trivial*. TrialByFire has: conditional branching (settle vs. escalate based on confidence margin), parallel execution (evidence gathering + advocate calls), multi-model coordination (3 different LLM calls with interdependent outputs), onchain state verification (EVM reads for market parameters), and consensus-verified settlement (EVM writes through the Forwarder). That's 8+ capability invocations with complex control flow. More importantly, the CRE DON's BFT consensus means the entire trial — not just the settlement — is decentralized and tamper-proof. Running this adversarial protocol on CRE is fundamentally different from running it on a centralized server, because no single node can manipulate the debate outcome.

---

## BUILD PLAN (Solo Developer, ~20 days)

| Phase | Days | Deliverables | Risk Level |
|-------|------|-------------|------------|
| **Week 1: Foundation** | | | |
| CRE Setup & Hello World | Day 1-2 | CRE CLI installed, TypeScript project initialized, basic Cron Trigger → callback → log confirmed in simulation | Low |
| Smart Contract | Day 3-5 | `TrialMarket.sol` deployed to Sepolia: `createMarket()`, `takePosition()`, `requestSettlement()`, `settle()`, `escalate()`, event emissions, access control | Low |
| **Week 2: Core Workflow** | | | |
| Evidence Pipeline | Day 6-7 | CRE HTTP Client fetching from 2+ external APIs, aggregating into structured evidence bundle | Low |
| Adversarial Debate | Day 8-10 | Two parallel LLM calls (advocates) + one sequential LLM call (judge). Structured JSON prompts and parsing. Full debate transcript generated. Simulation working end-to-end. | Medium |
| Settlement Logic | Day 11-12 | Confidence threshold check + conditional EVM write (settle or escalate). Full workflow simulates: trigger → evidence → debate → settle/escalate → onchain state change. | Medium |
| **Week 3: Polish & Demo** | | | |
| Frontend Dashboard | Day 13-16 | React app: market view, live trial transcript (side-by-side advocate arguments), judge scorecard, settlement status, escalation panel | Low |
| Demo Recording | Day 17-18 | 4.5-min video: two scenarios (resolve + escalate), CRE simulation log walkthrough, dashboard demo | Low |
| README & Submission | Day 19-20 | Public GitHub repo, README with Chainlink usage links, Devfolio submission, final testing | Low |

**Critical path:** Days 8-12 (adversarial debate + settlement logic in CRE). If this works in simulation by Day 12, the project ships. Everything else is polish.

---

## OUTPUT VALIDATION

| Check | Status |
|-------|--------|
| Every tech component has verified availability | ☑ All ✅ — CRE SDK, CLI, HTTP Client, EVM Client, triggers, Data Feeds, Sepolia, public LLM APIs, public data APIs |
| Demo can run live (not slideware) | ☑ CRE simulation makes real HTTP calls to real LLM APIs and real chain. Sepolia txs verifiable on Etherscan. |
| Wow moment is clear and occurs before minute 3 | ☑ Primary at ~2:00 (adversarial debate streaming in CRE terminal), secondary at ~2:40 (settlement tx) |
| Connects to at least 3 winning patterns | ☑ Connects to all 5 winning patterns from synthesis |
| Avoids all identified anti-patterns | ☑ Not oracle wrapper (8+ capabilities, conditional branching), not AI-advisor-only (AI executes full debate + settlement), not rebuilding sponsor product (Polymarket does deterministic; this does subjective) |
| Has mitigations for all high-probability risks | ☑ LLM latency (parallel calls + timeout), bias (multi-model diversity), hallucination (evidence-bound + judge flagging + escalation), scope (hard boundaries defined) |

---

## WHY "TRIALBYFIRE" SPECIFICALLY WINS AT CONVERGENCE

1. **The name tells the story.** Every judge who reads "TrialByFire" immediately understands the concept: a trial. Adversarial. High stakes. This is more memorable than any acronym or generic product name.

2. **The demo is theatrical.** Watching two AIs argue a case in real-time, cite evidence, and get scored by a judge — in a CRE terminal — is inherently more engaging than watching a dashboard update. It's the most visually compelling CRE workflow any judge will see.

3. **It solves a stated Chainlink gap.** The Polymarket partnership announcement explicitly says they're "exploring methodologies" for subjective resolution. TrialByFire IS a methodology. Judges from Chainlink will recognize this immediately.

4. **The escalation path shows maturity.** Most hackathon projects present AI as infallible. TrialByFire explicitly acknowledges AI limitations and builds a graceful degradation path. This signals engineering maturity that judges reward.

5. **It's dual-track eligible.** Submit to Prediction Markets (less competition, validated gap) OR CRE & AI (higher prize pool, strong fit). Decide at submission time based on what other projects look like.

6. **The academic backing is real.** DebateCV (2025), D3 framework (2025), Khan et al. (ICML 2024) — adversarial debate for AI verification is a hot research area. TrialByFire is the first onchain implementation via CRE. That's a paper-worthy contribution, not just a hackathon project.

---

*Concept complete. Ready for build phase.*
