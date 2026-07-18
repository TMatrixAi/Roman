# Engine Baseline Snapshot — Task #32
**Captured:** 2026-07-18 | **Purpose:** Immutable reference for Phase 1 of the engine audit.

---

## 1. Data Flow (pipeline order)

```
All modules computed independently
  ↓
buildEnsemble(ensembleModuleEdges) → rawEnsembleProbability
  ↓
applyTieBreaker → ensembleProbability (no-op nudge removed; passes through unchanged if within TIE_BAND)
  ↓
computeDataQuality → dataQuality score (0-100) + label
  ↓
applyCalibration (fitted isotonic) OR calibrateProbability (fallback DQ-shrink) → generalProbability
  ↓
[if specialist available] blend generalProbability + specialistProbability → blendedProbability
  ↓
[if tourDiscount or surfaceSampleDiscount < 1] reliability shrink → preSimulatorProbability
  ↓
[if simulatorAdopted] blend with Monte Carlo → calibratedProbability
  ↓
computeUpsetRisk, computeRecommendation, computeEliteTier, checkFinalConsistency
  ↓
applyTieBreaker disclosure (tieBreakerApplied flag only, no pick change)
```

---

## 2. Tie-Breaker

| Constant | Value | Purpose |
|---|---|---|
| `TIE_BAND` | **3** | If \|raw - 50\| < 3, `tieBreakerApplied = true`, raw probability passes through unchanged |

**History:** The 7-step priority cascade (Serve & Return → Surface Elo → … → Head-to-Head) was removed in Task #5 (2026-07-15) after walk-forward audit showed every step performed at or below a coin flip when it actually decided the pick (53.7% / 46.7% vs 66.7% baseline). `decidingStep` is always `null` post-removal.

---

## 3. Module Weights & Importance

### MODULE_IMPORTANCE (Data Quality blend weight — higher = counts more toward DQ score)
| Module | Importance |
|---|---|
| surfaceElo | **1.3** |
| serveReturn | **1.2** |
| recentForm | **1.1** |
| availability | 0.9 |
| fatigue | 0.7 |
| headToHead | 0.5 |
| matchLoadRecovery | 0.4 |

### ENSEMBLE_WEIGHT_PRIOR (starting weight before reliability scaling)
| Module | Weight Prior |
|---|---|
| surfaceElo | **1.5** |
| serveReturn | **1.5** |
| recentForm | 1.3 |
| fatigue | 0.4 |
| headToHead | 0.4 |
| availability | 0.4 |
| matchLoadRecovery | 0.3 |

### CONFIDENCE_SHRINK (shrinks module's edge toward zero, reduces its influence)
| Module | Shrink |
|---|---|
| serveReturn | **0.45** |
| recentForm | **0.35** |
| (all others) | 1.0 (no shrink) |

### EXCLUDED_FROM_ENSEMBLE (module computes but does NOT vote in probability)
`availability`, `fatigue`, `matchLoadRecovery`

### EXCLUDED_FROM_DATA_QUALITY (module does NOT count toward DQ score)
`headToHead`

### Effective ensemble weight formula
`effectiveWeight = max(1, reliability) × weightPrior`

---

## 4. Fallback Calibration (DQ-shrink, used when no fitted isotonic model exists)

```
DQ < 20     → factor = 0.40
DQ 20–55    → factor = 0.40 + (DQ-20)/35 × 0.45  (linear 0.40→0.85)
DQ 55–65    → factor = 0.85  (flat cap)
DQ 65–85    → factor = 0.85 – (DQ-65)/20 × 0.30  (decay 0.85→0.55)
DQ 85–100   → factor = max(0.40, 0.55 – (DQ-85)/15 × 0.15)  (decay to 0.40)

calibrated = 50 + (raw - 50) × factor
clamped to [5, 95]
```

Re-validated Task #75, Task #157. Key finding: DQ 85-100 is the LEAST trustworthy band (10.7pt overconfidence gap) despite highest score — structural confound between "well-logged" vs "harder tour matches."

---

## 5. Elite Tier Gates

All seven gates must pass simultaneously:

| Gate | Threshold | Note |
|---|---|---|
| `dataQuality` | ≥ 55 | "Acceptable" label floor (DQ ≥ 65 is actively worse-calibrated; gate lowered Task #75) |
| `calibratedMargin` | ≥ 5 | Filters noise-dominated 50-55% band (Task #66) |
| `allCoreModelsAgree` | All 3 agree direction | Surface Elo + Serve & Return + Recent Form must all favor same player |
| `specialistApplied` | true | Validated segment specialist must have voted |
| `noModelConflict` | true | Calibration/specialist must NOT flip the raw evidence pick |
| `notHighDisagreement` | modelAgreement ≠ "HighDisagreement" | |
| `upsetRiskAcceptable` | upsetRisk ∈ {LOW, MODERATE} | |

`ELITE_DATA_QUALITY_THRESHOLD = 55`, `ELITE_MIN_CALIBRATED_MARGIN = 5`

Plus: `checkFinalConsistency` guard — any violation forces Elite to false regardless.

---

## 6. Recommendation Thresholds

Decision chain (first matching rule wins):

| Priority | Condition | Result |
|---|---|---|
| 1 | DQ < 25 OR label="Poor" | DO_NOT_RECOMMEND |
| 2 | margin < 8 AND (Mixed OR HighDisagreement) | NO_STRONG_SIGNAL |
| 3 | upsetRisk = EXTREME | HIGH_RISK |
| 4 | margin ≥ 22 AND DQ ≥ 45 AND (LOW\|MODERATE) AND not (Mixed\|HighDisagreement) | STRONG_RECOMMENDATION |
| 5 | margin ≥ 10 | MODERATE_LEAN |
| 6 | margin ≥ 8 AND (LOW\|MODERATE) AND not (Mixed\|HighDisagreement) | MODERATE_LEAN |
| 7 | fallthrough | HIGH_RISK |

`margin = |calibratedProbability - 50|`

**Note Task #120:** STRONG_RECOMMENDATION (margin ≥ 22) had worst log loss of any tier (0.736 > 0.693 coin-flip) on n=189. Thresholds unchanged — fix belongs in the calibration curve, not this gate.

---

## 7. Upset Risk

Score components (raw, pre-tier):
| Component | Max Points | Driven by |
|---|---|---|
| favoriteWeakness | 45 | weighted model disagreement on favorite side |
| uncertainty | 15 | closeness to 50/50 |
| sampleDepth | 10 | surface sample depth label |
| volatility | 7 | tournament volatility |

Tier thresholds: LOW < 25, MODERATE < 40, HIGH < 55, EXTREME ≥ 55

`CORE_CONFLICT_BONUS = 25` added when meaningfully-weighted core modules conflict.
`AGREEMENT_BAND = { Strong: 0, Moderate: 2, Mixed: 4, HighDisagreement: 8 }`

---

## 8. Model Agreement Categories

Computed by `computeWeightedDisagreement` on the ensemble probability spread:
`Strong` → `Moderate` → `Mixed` → `HighDisagreement`

`AGREEMENT_ORDER = ["Strong", "Moderate", "Mixed", "HighDisagreement"]`

Governing disagreement: worst of (feature-level, specialist-vs-general, simulator-vs-preSimulator).

---

## 9. Reliability Discounts (Task #151)

Applied when `!specialistApplied` only (specialist already corrects for tour/surface bias):

| Discount | Trigger | Effect |
|---|---|---|
| `TOUR_RELIABILITY_DISCOUNT[tour]` | Some tours underperform stated confidence | Multiplies reliability, shrinks toward 50 |
| `LOW_SURFACE_SAMPLE_DISCOUNT` | surfaceSampleDepth.label = "Low" | Same |

Combined multiplicatively. Shrinks `blendedProbability → preSimulatorProbability`.

---

## 10. Simulator Scope Gap (Task #61)

Simulator only sees Surface Elo + Serve & Return. Before applying its validated global weight:
```
simulatorScopeGap = max(0, maxExcludedSignalReliability - simulation.inputReliability)
simulatorScopeScale = max(0, 1 - simulatorScopeGap / 100)
simulatorWeight = globalWeight × simulatorScopeScale
```

A full 100-point gap zeros the simulator's vote. No gap → weight unchanged.

---

## 11. Database Column Inventory (predictions table)

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| player1Id, player2Id | text | |
| player1Name, player2Name | text | |
| surface, matchFormat | text | |
| tournamentLevel, tournamentName | text nullable | |
| predictedWinnerId, predictedWinnerName | text | |
| calibratedProbability | real | player1-relative, 0-100 |
| predictedWinnerProbability | real | always ≥ 50 |
| dataQuality | integer | 0-100 |
| dataQualityLabel | text | "Poor"/"Marginal"/"Acceptable"/"Good"/"Strong" |
| upsetRisk | text | "LOW"/"MODERATE"/"HIGH"/"EXTREME" |
| recommendation | text | see §6 |
| predictedSetScore | text | |
| engine | jsonb | Full EngineBreakdown (all module outputs, votes, reasons, risks, etc.) |
| matchIdentityKey | text | order-independent key over players+tournament+surface+format |
| inputSnapshotHash | text | SHA-256 of resolved match histories |
| actualWinnerId, actualWinnerName | text nullable | set when graded |
| createdAt | timestamp with tz | |
| resolvedAt | timestamp with tz nullable | |

**Added by Task #32:** `decision_trace` (jsonb nullable) — full per-module edge values, pipeline intermediate probabilities, recommendation rule chain, elite gate pass/fail breakdown.

---

## 12. Known Issues at Snapshot Time

| Issue | Evidence | Task |
|---|---|---|
| Tie-break cascade | **Fixed** (Task #5, 2026-07-15) — cascade removed, honest 50/50 disclosure | #7 pending review |
| STRONG_RECOMMENDATION calibration | Worst log loss of all tiers (0.736) on n=189 | Fix belongs in calibration curve |
| DQ 85-100 overconfidence | -10.7pt gap, worse than coin flip log loss | Structural confound, re-validate with walk-forward re-fit |
| Decision explainability | No intermediate pipeline probabilities stored | Fixed by this task |
