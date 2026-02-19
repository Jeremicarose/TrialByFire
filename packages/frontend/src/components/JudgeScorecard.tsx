import type { JudgeRuling } from "../types";
import "./JudgeScorecard.css";

interface JudgeScorecardProps {
  ruling: JudgeRuling;
}

/*
 * JudgeScorecard displays the judge's evaluation of both advocates.
 *
 * Structure:
 *   1. Verdict badge — large YES/NO with aggregate scores
 *   2. Per-criterion bars — side-by-side comparison for each rubric item
 *   3. Ruling text — the judge's prose explanation (blockquote style)
 *   4. Hallucinations — flagged citations not found in evidence bundle
 *
 * The per-criterion bars are the key visual: two bars growing from the
 * center outward (YES to the left in blue, NO to the right in red).
 * This makes it immediately obvious which side won each criterion
 * without needing to read numbers.
 */
export function JudgeScorecard({ ruling }: JudgeScorecardProps) {
  const margin = Math.abs(ruling.scoreYes - ruling.scoreNo);

  return (
    <section className="scorecard reveal" style={{ animationDelay: "0.2s" }}>
      <div className="section-label">Judge Ruling</div>

      {/* ── Verdict Header ── */}
      <div className="scorecard__verdict-row">
        <div className={`scorecard__verdict-badge scorecard__verdict-badge--${ruling.finalVerdict.toLowerCase()}`}>
          <span className="scorecard__verdict-label mono">Verdict</span>
          <span className="scorecard__verdict-value serif">{ruling.finalVerdict}</span>
        </div>

        {/* Aggregate scores — the overall numbers */}
        <div className="scorecard__aggregate">
          <div className="scorecard__score scorecard__score--yes">
            <span className="scorecard__score-label mono">YES</span>
            <span className="scorecard__score-value mono">{ruling.scoreYes}</span>
          </div>
          <div className="scorecard__margin mono">
            <span className="scorecard__margin-label">Margin</span>
            <span className="scorecard__margin-value">{margin}</span>
          </div>
          <div className="scorecard__score scorecard__score--no">
            <span className="scorecard__score-label mono">NO</span>
            <span className="scorecard__score-value mono">{ruling.scoreNo}</span>
          </div>
        </div>
      </div>

      {/* ── Per-Criterion Score Bars ── */}
      <div className="scorecard__criteria">
        {ruling.criterionScores.map((cs, i) => (
          <div
            key={cs.criterion}
            className="score-row reveal"
            style={{ animationDelay: `${0.3 + i * 0.1}s` }}
          >
            {/* Criterion name centered above the bars */}
            <div className="score-row__header">
              <span className="score-row__criterion">{cs.criterion}</span>
            </div>

            {/*
             * Dual bar visualization:
             * Two bars grow from the center. YES bar extends left (blue),
             * NO bar extends right (red). The wider bar = the winner.
             *
             * Width is calculated as a percentage of 100. We use
             * flex-direction: row-reverse for the YES side so the bar
             * grows leftward from the center.
             */}
            <div className="score-row__bars">
              {/* YES bar — grows from center to left */}
              <div className="score-row__bar-container score-row__bar-container--yes">
                <span className="score-row__bar-value mono">{cs.scoreYes}</span>
                <div className="score-row__bar-track">
                  <div
                    className="score-row__bar-fill score-row__bar-fill--yes"
                    style={{ width: `${cs.scoreYes}%` }}
                  />
                </div>
              </div>

              {/* Center divider */}
              <div className="score-row__center-line" />

              {/* NO bar — grows from center to right */}
              <div className="score-row__bar-container score-row__bar-container--no">
                <div className="score-row__bar-track">
                  <div
                    className="score-row__bar-fill score-row__bar-fill--no"
                    style={{ width: `${cs.scoreNo}%` }}
                  />
                </div>
                <span className="score-row__bar-value mono">{cs.scoreNo}</span>
              </div>
            </div>

            {/* Judge's reasoning for this criterion */}
            <p className="score-row__reasoning">{cs.reasoning}</p>
          </div>
        ))}
      </div>

      {/* ── Ruling Text — the judge's prose explanation ── */}
      <blockquote className="scorecard__ruling">
        <div className="scorecard__ruling-label mono">Written Ruling</div>
        <p className="scorecard__ruling-text serif">{ruling.rulingText}</p>
        <cite className="scorecard__ruling-model mono">
          — {ruling.model}
        </cite>
      </blockquote>

      {/*
       * Hallucinations Section — only renders if any were detected.
       * Highlighted in warning red because this is the safety mechanism
       * that triggers market escalation. Demonstrates that TrialByFire
       * doesn't blindly trust AI output.
       */}
      {ruling.hallucinationsDetected.length > 0 && (
        <div className="scorecard__hallucinations">
          <div className="scorecard__hallucinations-label mono">
            Hallucinations Detected
          </div>
          <ul className="scorecard__hallucinations-list">
            {ruling.hallucinationsDetected.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
