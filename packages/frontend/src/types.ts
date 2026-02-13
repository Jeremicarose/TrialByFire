// Re-export types from engine for frontend use.
// Duplicated here to avoid cross-workspace import issues with Vite.

export type Verdict = "YES" | "NO";
export type SettlementAction = "RESOLVE" | "ESCALATE";

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
}

export interface ResolutionRubric {
  criteria: RubricCriterion[];
  evidenceSources: string[];
  confidenceThreshold: number;
}

export interface MarketQuestion {
  id: string;
  question: string;
  rubric: ResolutionRubric;
  settlementDeadline: Date;
  metadata?: Record<string, string>;
}

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

export interface CriterionArgument {
  criterion: string;
  claim: string;
  evidenceCitations: string[];
  strength: number;
}

export interface AdvocateArgument {
  side: Verdict;
  confidence: number;
  arguments: CriterionArgument[];
  weaknessesInOpposingCase: string[];
  model: string;
}

export interface CriterionScore {
  criterion: string;
  scoreYes: number;
  scoreNo: number;
  reasoning: string;
}

export interface JudgeRuling {
  finalVerdict: Verdict;
  scoreYes: number;
  scoreNo: number;
  criterionScores: CriterionScore[];
  rulingText: string;
  hallucinationsDetected: string[];
  model: string;
}

export interface SettlementDecision {
  action: SettlementAction;
  verdict: Verdict | null;
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
