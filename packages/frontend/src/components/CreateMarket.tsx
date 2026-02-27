import { useState } from "react";
import { ethers } from "ethers";
import "./CreateMarket.css";

interface CreateMarketProps {
  onSubmit: (question: string, rubricHash: string, deadline: number) => Promise<unknown>;
  isLoading: boolean;
}

const DEFAULT_CRITERIA = [
  { name: "Data accuracy", description: "Are the cited numbers verifiable?", weight: 30 },
  { name: "Time period coverage", description: "Does evidence cover the full period?", weight: 25 },
  { name: "Source diversity", description: "Are multiple independent sources used?", weight: 20 },
  { name: "Logical coherence", description: "Is the argument internally consistent?", weight: 25 },
];

export function CreateMarket({ onSubmit, isLoading }: CreateMarketProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [deadlineStr, setDeadlineStr] = useState("");
  const [threshold, setThreshold] = useState(20);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);

  const handleWeightChange = (index: number, value: string) => {
    const updated = [...criteria];
    updated[index] = { ...updated[index], weight: parseInt(value) || 0 };
    setCriteria(updated);
  };

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !deadlineStr) return;

    const deadlineUnix = Math.floor(new Date(deadlineStr).getTime() / 1000);

    /*
     * Build a deterministic rubric JSON and hash it with keccak256.
     * This produces a content-addressed hash — the same rubric
     * always produces the same hash, so anyone can verify the rubric
     * that was used by re-hashing the original data.
     *
     * The rubric object includes criteria (name + weight) and the
     * confidence threshold. Description is excluded from the hash
     * because it's human-facing text, not scoring logic.
     */
    const rubricData = {
      criteria: criteria.map((c) => ({ name: c.name, weight: c.weight })),
      confidenceThreshold: threshold,
    };
    const rubricJson = JSON.stringify(rubricData);
    const rubricHash = ethers.keccak256(ethers.toUtf8Bytes(rubricJson));

    await onSubmit(question, rubricHash, deadlineUnix);
    setQuestion("");
    setDeadlineStr("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <div className="create-market">
        <button className="create-market__toggle" onClick={() => setIsOpen(true)}>
          <span className="create-market__toggle-icon">+</span>
          File New Market
        </button>
      </div>
    );
  }

  return (
    <div className="create-market">
      <form className="create-market__form" onSubmit={handleSubmit}>
        <h3 className="create-market__form-title">New Prediction Market</h3>

        <div className="form-field">
          <label className="form-field__label">Question</label>
          <textarea
            className="form-field__textarea"
            placeholder="Enter a subjective question that requires judgment to resolve..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
        </div>

        <div className="form-field">
          <label className="form-field__label">Resolution Rubric</label>
          <div className="rubric-grid">
            {criteria.map((c, i) => (
              <div key={c.name} className="rubric-item">
                <div className="rubric-item__name">{c.name}</div>
                <div className="rubric-item__desc">{c.description}</div>
                <div className="rubric-item__weight-row">
                  <input
                    type="number"
                    className="rubric-item__weight-input"
                    value={c.weight}
                    onChange={(e) => handleWeightChange(i, e.target.value)}
                    min={0}
                    max={100}
                  />
                  <span className="rubric-item__weight-label">% weight</span>
                </div>
              </div>
            ))}
          </div>
          {totalWeight !== 100 && (
            <div style={{ color: "var(--warning-primary)", fontSize: "0.75rem", marginTop: "var(--space-sm)", fontFamily: "var(--font-mono)" }}>
              Weights sum to {totalWeight}% (should be 100%)
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-field__label">Deadline</label>
            <input
              type="datetime-local"
              className="form-field__input"
              value={deadlineStr}
              onChange={(e) => setDeadlineStr(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label className="form-field__label">Confidence Threshold</label>
            <input
              type="number"
              className="form-field__input"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value) || 0)}
              min={1}
              max={100}
              placeholder="20"
            />
          </div>
        </div>

        <button
          type="submit"
          className="create-market__submit"
          disabled={isLoading || !question.trim() || !deadlineStr || totalWeight !== 100}
        >
          {isLoading ? "Creating..." : "Create Market — 0.01 ETH Deposit"}
        </button>
        <div className="create-market__deposit-note">
          Deposit is refunded after market settlement
        </div>
      </form>
    </div>
  );
}
