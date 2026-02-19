import type { AdvocateArgument } from "../types";
import "./TrialTranscript.css";

interface TrialTranscriptProps {
  advocateYes: AdvocateArgument;
  advocateNo: AdvocateArgument;
}

/*
 * TrialTranscript renders the adversarial debate as a side-by-side comparison.
 *
 * Layout:
 *   LEFT COLUMN (blue)  — YES advocate's arguments
 *   RIGHT COLUMN (red)  — NO advocate's arguments
 *
 * Each argument card contains:
 *   - Criterion name (matches the rubric)
 *   - Claim text (the advocate's argument)
 *   - Evidence citations (tags referencing the evidence bundle)
 *   - Strength bar (self-assessed 0-100)
 *
 * The staggered reveal animation makes arguments appear one by one,
 * creating the theatrical "testimony being read" effect described
 * in the concept doc's demo flow.
 */
export function TrialTranscript({ advocateYes, advocateNo }: TrialTranscriptProps) {
  return (
    <section className="transcript reveal" style={{ animationDelay: "0.15s" }}>
      <div className="section-label">Adversarial Debate</div>

      <div className="transcript__columns">
        {/* ── YES Advocate Column ── */}
        <AdvocateColumn advocate={advocateYes} side="yes" />

        {/* Vertical divider between the two columns */}
        <div className="transcript__divider">
          <span className="transcript__vs mono">VS</span>
        </div>

        {/* ── NO Advocate Column ── */}
        <AdvocateColumn advocate={advocateNo} side="no" />
      </div>
    </section>
  );
}

/*
 * AdvocateColumn renders one side's arguments.
 * Extracted as a sub-component to avoid duplicating the argument
 * card rendering logic for YES and NO.
 *
 * The `side` prop controls the color scheme (blue vs red)
 * via CSS class names like `advocate--yes` and `advocate--no`.
 */
function AdvocateColumn({ advocate, side }: { advocate: AdvocateArgument; side: "yes" | "no" }) {
  const sideLabel = side === "yes" ? "YES" : "NO";

  return (
    <div className={`advocate advocate--${side}`}>
      {/* Column header: side label, model name, confidence score */}
      <div className="advocate__header">
        <div className="advocate__side mono">{sideLabel} Advocate</div>
        <div className="advocate__meta">
          <span className="advocate__model mono">{advocate.model}</span>
          <span className="advocate__confidence mono">
            {advocate.confidence}% confident
          </span>
        </div>
      </div>

      {/* Argument cards — one per rubric criterion */}
      <div className="advocate__arguments">
        {advocate.arguments.map((arg, i) => (
          <div
            key={arg.criterion}
            className="argument-card reveal"
            /*
             * Staggered animation: each card appears 0.15s after the previous.
             * The offset (0.3s) ensures the column header is visible first.
             */
            style={{ animationDelay: `${0.3 + i * 0.15}s` }}
          >
            {/* Criterion name — matches a rubric criterion */}
            <div className="argument-card__criterion mono">{arg.criterion}</div>

            {/* The actual argument text */}
            <p className="argument-card__claim">{arg.claim}</p>

            {/* Evidence citations as clickable-looking tags */}
            <div className="argument-card__citations">
              {arg.evidenceCitations.map((cite, j) => (
                <span key={j} className="citation-tag mono">{cite}</span>
              ))}
            </div>

            {/*
             * Strength bar: visual representation of self-assessed strength.
             * The width is set inline as a percentage.
             * This helps judges quickly scan which arguments the advocate
             * considers strongest vs weakest.
             */}
            <div className="argument-card__strength">
              <span className="strength-label mono">Strength</span>
              <div className="strength-bar">
                <div
                  className="strength-bar__fill"
                  style={{ width: `${arg.strength}%` }}
                />
              </div>
              <span className="strength-value mono">{arg.strength}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Weaknesses identified in the opposing case */}
      {advocate.weaknessesInOpposingCase.length > 0 && (
        <div className="advocate__weaknesses">
          <div className="advocate__weaknesses-title mono">
            Identified Weaknesses in Opposing Case
          </div>
          <ul className="advocate__weaknesses-list">
            {advocate.weaknessesInOpposingCase.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
