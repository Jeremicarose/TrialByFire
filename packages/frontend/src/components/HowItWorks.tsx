import "./HowItWorks.css";

/*
 * HowItWorks — Hero explainer section for new visitors.
 *
 * This is the first thing a hackathon judge or new user sees.
 * Three-step visual flow explains the entire protocol in seconds:
 *   1. File a Case → 2. Adversarial Trial → 3. Onchain Settlement
 *
 * Below the steps, three badges highlight the Chainlink integrations
 * so judges immediately see the sponsor tech being used.
 */
export function HowItWorks() {
  return (
    <section className="how-it-works reveal">
      <div className="how-it-works__hero">
        <h2 className="how-it-works__headline serif">
          Subjective Questions.<br />
          Objective Settlement.
        </h2>
        <p className="how-it-works__subtext">
          Traditional prediction markets can only resolve &quot;what price?&quot;
          TrialByFire resolves <em>subjective</em> questions — &quot;Did quality improve?&quot;
          &quot;Was the policy effective?&quot; — using adversarial AI debate, scored
          against transparent rubrics, settled trustlessly onchain.
        </p>
      </div>

      <div className="how-it-works__steps">
        <div className="how-it-works__step reveal reveal-delay-1">
          <div className="how-it-works__step-number mono">01</div>
          <div className="how-it-works__step-icon">&#9878;</div>
          <h3 className="how-it-works__step-title">File a Case</h3>
          <p className="how-it-works__step-desc">
            Anyone creates a market with a question, rubric criteria, and deadline.
            Participants stake ETH on YES or NO.
          </p>
        </div>

        <div className="how-it-works__connector">&#10230;</div>

        <div className="how-it-works__step reveal reveal-delay-2">
          <div className="how-it-works__step-number mono">02</div>
          <div className="how-it-works__step-icon">&#9879;</div>
          <h3 className="how-it-works__step-title">Adversarial Trial</h3>
          <p className="how-it-works__step-desc">
            Two AI advocates debate with real evidence. A judge scores each argument
            against the rubric. Hallucinations are flagged and penalized.
          </p>
        </div>

        <div className="how-it-works__connector">&#10230;</div>

        <div className="how-it-works__step reveal reveal-delay-3">
          <div className="how-it-works__step-number mono">03</div>
          <div className="how-it-works__step-icon">&#9876;</div>
          <h3 className="how-it-works__step-title">Onchain Settlement</h3>
          <p className="how-it-works__step-desc">
            If the margin exceeds the confidence threshold, the market resolves
            automatically. Winners claim proportional payouts. If uncertain, stakes are refunded.
          </p>
        </div>
      </div>

      <div className="how-it-works__chainlink">
        <span className="how-it-works__chainlink-label mono">Powered by Chainlink</span>
        <div className="how-it-works__badges">
          <div className="how-it-works__badge">
            <span className="how-it-works__badge-name mono">Functions</span>
            <span className="how-it-works__badge-desc">Decentralized trial execution on the DON</span>
          </div>
          <div className="how-it-works__badge">
            <span className="how-it-works__badge-name mono">Automation</span>
            <span className="how-it-works__badge-desc">Auto-triggers settlement at deadline</span>
          </div>
          <div className="how-it-works__badge">
            <span className="how-it-works__badge-name mono">Data Feeds</span>
            <span className="how-it-works__badge-desc">Live ETH/USD price as trusted evidence</span>
          </div>
        </div>
      </div>
    </section>
  );
}
