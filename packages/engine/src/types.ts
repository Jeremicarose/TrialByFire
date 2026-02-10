import { z } from "zod";

// ── Market Question ──────────────────────────────────────────────

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number; // 0-100, all weights should sum to 100
}

export interface ResolutionRubric {
  criteria: RubricCriterion[];
  evidenceSources: string[];
  confidenceThreshold: number; // margin required to auto-resolve (e.g. 20)
}

export interface MarketQuestion {
  id: string;
  question: string;
  rubric: ResolutionRubric;
  settlementDeadline: Date;
  metadata?: Record<string, string>;
}

// ── Evidence ─────────────────────────────────────────────────────

export interface EvidenceItem {
  source: string;
  title: string;
  content: string;
  url?: string;
  retrievedAt: Date;
}

export interface EvidenceBundle {
  questionId: string;
  items: EvidenceItem[];
  gatheredAt: Date;
}

// ── Advocate ─────────────────────────────────────────────────────

export type Verdict = "YES" | "NO";

export interface CriterionArgument {
  criterion: string;
  claim: string;
  evidenceCitations: string[];
  strength: number; // 0-100
}

export interface AdvocateArgument {
  side: Verdict;
  confidence: number; // 0-100
  arguments: CriterionArgument[];
  weaknessesInOpposingCase: string[];
  model: string;
}

// ── Judge ────────────────────────────────────────────────────────

export interface CriterionScore {
  criterion: string;
  scoreYes: number; // 0-100
  scoreNo: number; // 0-100
  reasoning: string;
}

export interface JudgeRuling {
  finalVerdict: Verdict;
  scoreYes: number; // aggregate 0-100
  scoreNo: number; // aggregate 0-100
  criterionScores: CriterionScore[];
  rulingText: string;
  hallucinationsDetected: string[];
  model: string;
}

// ── Pipeline Output ──────────────────────────────────────────────

export type SettlementAction = "RESOLVE" | "ESCALATE";

export interface SettlementDecision {
  action: SettlementAction;
  verdict: Verdict | null; // null when escalated
  margin: number;
  reason: string;
}

export interface TrialTranscript {
  question: MarketQuestion;
  evidence: EvidenceBundle;
  advocateYes: AdvocateArgument;
  advocateNo: AdvocateArgument;
  judgeRuling: JudgeRuling;
  decision: SettlementDecision;
  executedAt: Date;
  durationMs: number;
}

// ── Zod Schemas (runtime validation of LLM JSON output) ─────────

export const AdvocateArgumentSchema = z.object({
  side: z.enum(["YES", "NO"]),
  confidence: z.number().min(0).max(100),
  arguments: z.array(
    z.object({
      criterion: z.string(),
      claim: z.string(),
      evidenceCitations: z.array(z.string()),
      strength: z.number().min(0).max(100),
    })
  ),
  weaknessesInOpposingCase: z.array(z.string()),
});

export const JudgeRulingSchema = z.object({
  finalVerdict: z.enum(["YES", "NO"]),
  scoreYes: z.number().min(0).max(100),
  scoreNo: z.number().min(0).max(100),
  criterionScores: z.array(
    z.object({
      criterion: z.string(),
      scoreYes: z.number().min(0).max(100),
      scoreNo: z.number().min(0).max(100),
      reasoning: z.string(),
    })
  ),
  rulingText: z.string(),
  hallucinationsDetected: z.array(z.string()),
});
