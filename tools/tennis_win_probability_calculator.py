#!/usr/bin/env python3
"""
Tennis match win-probability calculator.

Standalone sanity-check tool for the calibration approach used by the main prediction app.
It blends three independent signals (surface Elo, serve/return, recent form) into a single
win probability, then applies uncertainty shrinkage, an optional home-advantage nudge, and a
tier-aware realism clamp -- while running explicit validation checks that catch the exact class
of bug that shipped before (a component quietly mislabeled as favoring the wrong player).

Design principles (mirrors the main app's "never fabricate" philosophy):
  - Pure weighted average only. No multiplicative "confidence bonus" when signals agree --
    that kind of compounding silently overstates confidence and was part of the original bug.
  - Every adjustment (shrinkage, home bonus, tier clip) is applied as a separate, visible step
    so you can see exactly how far the final number moved from the naive blend, and why.
  - Validation checks are optional-input-driven: if you don't supply a predicted set score or
    an upset-risk label, that specific check is skipped and reported as "not checked" rather
    than silently passing.

Usage:
    python tennis_win_probability_calculator.py --demo
    python tennis_win_probability_calculator.py \\
        --elo-a 1557 --elo-b 1648 \\
        --serve-return-a 0.64 --recent-form-a 0.52 \\
        --weight-elo 0.33 --weight-serve-return 0.32 --weight-form 0.29 \\
        --tier challenger_itf

Or import and call `calculate_win_probability(...)` directly from your own code.
"""

from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Tiers and their realism bands
# ---------------------------------------------------------------------------


class Tier(str, Enum):
    """Match level, used only to decide how extreme a probability we're willing to output.
    Lower tiers have thinner data (smaller sample sizes, noisier surface/form signals), so
    they get a tighter band regardless of how confident the raw blend looks."""

    CHALLENGER_ITF = "challenger_itf"  # below ATP 250
    ATP_250 = "atp250"  # ATP 250 / WTA 250 -- more data than Challenger, still not elite
    ELITE = "elite"  # ATP 500+ / Masters / Grand Slam


# (lower_bound, upper_bound) probability clamp per tier. The spec only pins down the two
# endpoints explicitly (Challenger/ITF: 25-75%, elite with high data quality: up to 85%); the
# ATP 250 band is a reasonable middle ground between them, not independently specified.
TIER_BANDS: dict[Tier, tuple[float, float]] = {
    Tier.CHALLENGER_ITF: (0.25, 0.75),
    Tier.ATP_250: (0.20, 0.80),
    Tier.ELITE: (0.15, 0.85),
}

# The elite tier's wider 85% ceiling only applies when data quality clears this bar; otherwise
# it's treated like an ATP 250 match for clamping purposes.
ELITE_DATA_QUALITY_THRESHOLD = 90.0

HOME_ADVANTAGE_CAP = 0.03  # +/-3%, per spec
DISAGREEMENT_SHRINK_THRESHOLD = 0.10  # std dev above which we start shrinking toward 0.5
SHRINK_MIN_FRACTION = 0.15  # at the threshold, shrink 15% of the way toward 0.5
SHRINK_MAX_FRACTION = 0.20  # fully saturated (std dev >= 0.20), shrink 20% of the way
SHRINK_SATURATION_STD = 0.20


# ---------------------------------------------------------------------------
# Inputs / outputs
# ---------------------------------------------------------------------------


@dataclass
class MatchInputs:
    player_a_surface_elo: float
    player_b_surface_elo: float
    serve_return_prob_a: float
    recent_form_prob_a: float
    weight_elo: float
    weight_serve_return: float
    weight_form: float
    tier: Tier = Tier.CHALLENGER_ITF
    data_quality: Optional[float] = None  # 0-100, only relevant for the elite tier's 85% ceiling
    home_advantage_bonus: Optional[float] = None  # small additive nudge, capped at +/-3%
    # Optional extras purely for the validation checks below -- if omitted, those specific
    # checks are skipped rather than assumed to pass.
    predicted_sets: Optional[list[tuple[int, int]]] = None  # [(games_a, games_b), ...] per set
    upset_risk_label: Optional[str] = None  # "LOW" / "MEDIUM" / "HIGH"
    historical_upset_rate_at_tier: Optional[float] = None  # 0-1

    # Populated by __post_init__ if the supplied weights didn't sum to exactly 1.0 and had to be
    # rescaled; surfaced as a warning rather than silently absorbed.
    weight_normalization_note: Optional[str] = field(default=None, init=False)

    # Weight sums off by more than this are almost certainly a real mistake (e.g. a missing
    # component, or numbers pasted from the wrong place) rather than rounding in a hand-typed
    # spec, and should fail loudly instead of being silently rescaled.
    _MAX_AUTO_NORMALIZE_DEVIATION = 0.10

    def __post_init__(self) -> None:
        for name, value in [
            ("serve_return_prob_a", self.serve_return_prob_a),
            ("recent_form_prob_a", self.recent_form_prob_a),
        ]:
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be between 0 and 1, got {value}")

        weight_sum = self.weight_elo + self.weight_serve_return + self.weight_form
        if abs(weight_sum - 1.0) > 1e-6:
            if weight_sum <= 0 or abs(weight_sum - 1.0) > self._MAX_AUTO_NORMALIZE_DEVIATION:
                raise ValueError(
                    f"weight_elo + weight_serve_return + weight_form must sum to 1.0, got {weight_sum}"
                )
            # Close enough to 1.0 that this reads as a rounding slip (e.g. weights hand-typed as
            # 0.33/0.32/0.29 = 0.94) rather than a real input error -- rescale proportionally and
            # say so explicitly, instead of either silently accepting unnormalized weights or
            # hard-failing on a near-miss.
            original = (self.weight_elo, self.weight_serve_return, self.weight_form)
            self.weight_elo /= weight_sum
            self.weight_serve_return /= weight_sum
            self.weight_form /= weight_sum
            self.weight_normalization_note = (
                f"Supplied weights {original[0]:g}/{original[1]:g}/{original[2]:g} summed to "
                f"{weight_sum:g}, not 1.0 -- rescaled proportionally to "
                f"{self.weight_elo:.4f}/{self.weight_serve_return:.4f}/{self.weight_form:.4f}."
            )

        if self.home_advantage_bonus is not None and abs(self.home_advantage_bonus) > HOME_ADVANTAGE_CAP:
            raise ValueError(
                f"home_advantage_bonus must be within +/-{HOME_ADVANTAGE_CAP:.0%}, "
                f"got {self.home_advantage_bonus:.3f}"
            )


@dataclass
class WinProbabilityResult:
    # Raw component probabilities (all "prob favoring player A")
    elo_prob_a: float
    serve_return_prob_a: float
    recent_form_prob_a: float

    disagreement_std: float
    shrink_fraction_applied: float

    blend_before_shrinkage: float
    prob_after_shrinkage: float
    prob_after_home_bonus: float
    final_prob_a: float  # after tier clip -- the number to actually use

    tier_band: tuple[float, float]
    was_clipped: bool

    warnings: list[str] = field(default_factory=list)
    explanation: str = ""


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def elo_to_prob(elo_a: float, elo_b: float) -> float:
    """Standard logistic Elo win-probability formula for player A."""
    return 1.0 / (1.0 + 10 ** (-(elo_a - elo_b) / 400.0))


def _shrink_fraction_for(std_dev: float) -> float:
    """Linearly scale the shrink fraction from 15% (right at the disagreement threshold) up to
    20% (fully saturated), rather than jumping straight to a fixed number the moment the
    threshold is crossed -- a match barely over the line shouldn't get shrunk as hard as one
    with wildly disagreeing components."""
    if std_dev < DISAGREEMENT_SHRINK_THRESHOLD:
        return 0.0
    span = SHRINK_SATURATION_STD - DISAGREEMENT_SHRINK_THRESHOLD
    progress = min(1.0, (std_dev - DISAGREEMENT_SHRINK_THRESHOLD) / span) if span > 0 else 1.0
    return SHRINK_MIN_FRACTION + progress * (SHRINK_MAX_FRACTION - SHRINK_MIN_FRACTION)


def _effective_tier_band(tier: Tier, data_quality: Optional[float]) -> tuple[float, float]:
    if tier == Tier.ELITE:
        if data_quality is not None and data_quality > ELITE_DATA_QUALITY_THRESHOLD:
            return TIER_BANDS[Tier.ELITE]
        return TIER_BANDS[Tier.ATP_250]
    return TIER_BANDS[tier]


def _majority_favorite(components: dict[str, float]) -> Optional[str]:
    """'A', 'B', or None (split) -- whichever player a majority of the three components favor."""
    votes_a = sum(1 for p in components.values() if p > 0.5)
    votes_b = sum(1 for p in components.values() if p < 0.5)
    if votes_a > votes_b:
        return "A"
    if votes_b > votes_a:
        return "B"
    return None


def calculate_win_probability(inputs: MatchInputs) -> WinProbabilityResult:
    warnings: list[str] = []
    if inputs.weight_normalization_note:
        warnings.append(inputs.weight_normalization_note)

    elo_prob_a = elo_to_prob(inputs.player_a_surface_elo, inputs.player_b_surface_elo)
    components = {
        "elo": elo_prob_a,
        "serve_return": inputs.serve_return_prob_a,
        "recent_form": inputs.recent_form_prob_a,
    }

    # --- Pure weighted linear blend. No multiplicative "agreement bonus", no compounding. ---
    blend = (
        inputs.weight_elo * elo_prob_a
        + inputs.weight_serve_return * inputs.serve_return_prob_a
        + inputs.weight_form * inputs.recent_form_prob_a
    )

    # --- Validation check 1: does the Elo component's favorite match the raw Elo comparison,
    # and -- more importantly -- does it match the blend's overall favorite? A component that
    # gets outvoted by the other two is normal, but it must be surfaced explicitly rather than
    # silently absorbed, since this is exactly the class of bug ("WIN PROB (ELO)" showing the
    # wrong favored player) that shipped before. ---
    elo_favorite = "A" if inputs.player_a_surface_elo > inputs.player_b_surface_elo else (
        "B" if inputs.player_b_surface_elo > inputs.player_a_surface_elo else None
    )
    elo_prob_favorite = "A" if elo_prob_a > 0.5 else ("B" if elo_prob_a < 0.5 else None)
    if elo_favorite != elo_prob_favorite:
        warnings.append(
            f"Elo self-consistency check failed: raw Elo ({inputs.player_a_surface_elo} vs "
            f"{inputs.player_b_surface_elo}) favors {elo_favorite}, but the derived Elo "
            f"probability ({elo_prob_a:.3f}) implies {elo_prob_favorite}. This should never "
            f"happen for a monotonic formula -- check for a rounding bug."
        )

    blend_favorite = "A" if blend > 0.5 else ("B" if blend < 0.5 else None)
    if elo_favorite is not None and blend_favorite is not None and elo_favorite != blend_favorite:
        winner_elo, loser_elo = (
            (inputs.player_a_surface_elo, inputs.player_b_surface_elo)
            if elo_favorite == "A"
            else (inputs.player_b_surface_elo, inputs.player_a_surface_elo)
        )
        warnings.append(
            f"Elo favors Player {elo_favorite} ({winner_elo:g} > {loser_elo:g}), not Player "
            f"{blend_favorite} -- the overall blend leans toward {blend_favorite} because the "
            f"serve/return and/or recent-form signals outweigh a weaker Elo signal pointing the "
            f"other way. This is not a bug by itself, but don't let a UI label imply Elo agrees "
            f"with the final pick when it doesn't."
        )

    # --- Uncertainty shrinkage toward 0.5, proportional to component disagreement. ---
    disagreement_std = statistics.pstdev(components.values())
    shrink_fraction = _shrink_fraction_for(disagreement_std)
    prob_after_shrinkage = blend + (0.5 - blend) * shrink_fraction

    # --- Optional home-advantage nudge (already validated as within +/-3% in MatchInputs). ---
    prob_after_home_bonus = prob_after_shrinkage
    if inputs.home_advantage_bonus:
        prob_after_home_bonus = prob_after_shrinkage + inputs.home_advantage_bonus

    # --- Tier-aware realism clamp. ---
    lower, upper = _effective_tier_band(inputs.tier, inputs.data_quality)
    final_prob_a = min(upper, max(lower, prob_after_home_bonus))
    was_clipped = final_prob_a != prob_after_home_bonus

    # --- Validation check 2: predicted set score vs. predicted winner. ---
    if inputs.predicted_sets:
        sets_won_a = sum(1 for a, b in inputs.predicted_sets if a > b)
        sets_won_b = sum(1 for a, b in inputs.predicted_sets if b > a)
        set_score_favorite = "A" if sets_won_a > sets_won_b else ("B" if sets_won_b > sets_won_a else None)
        final_favorite = "A" if final_prob_a > 0.5 else ("B" if final_prob_a < 0.5 else None)
        if set_score_favorite is not None and final_favorite is not None and set_score_favorite != final_favorite:
            warnings.append(
                f"Predicted set score ({sets_won_a}-{sets_won_b} sets) implies Player "
                f"{set_score_favorite} wins, but the final probability ({final_prob_a:.3f}) "
                f"favors Player {final_favorite}. These contradict each other."
            )

    # --- Validation check 3: upset-risk label vs. disagreement / historical upset rate. ---
    if inputs.upset_risk_label:
        label = inputs.upset_risk_label.strip().upper()
        elevated_disagreement = disagreement_std > DISAGREEMENT_SHRINK_THRESHOLD
        elevated_historical_rate = (
            inputs.historical_upset_rate_at_tier is not None and inputs.historical_upset_rate_at_tier > 0.25
        )
        if label == "LOW" and (elevated_disagreement or elevated_historical_rate):
            reasons = []
            if elevated_disagreement:
                reasons.append(f"component disagreement std dev is {disagreement_std:.3f} (> {DISAGREEMENT_SHRINK_THRESHOLD})")
            if elevated_historical_rate:
                reasons.append(
                    f"historical upset rate at this tier is {inputs.historical_upset_rate_at_tier:.0%} (> 25%)"
                )
            warnings.append(
                f"Upset risk is labeled LOW, but {' and '.join(reasons)} -- that combination "
                f"doesn't support a LOW label."
            )

    # --- Plain-English explanation of how far the final number moved, and why. ---
    total_move = final_prob_a - blend
    move_reasons = []
    if shrink_fraction > 0:
        move_reasons.append(f"{shrink_fraction:.0%} shrinkage toward 0.5 (component disagreement std {disagreement_std:.3f})")
    if inputs.home_advantage_bonus:
        move_reasons.append(f"a {inputs.home_advantage_bonus:+.1%} home-advantage nudge")
    if was_clipped:
        move_reasons.append(f"a tier realism clamp to [{lower:.0%}, {upper:.0%}]")
    if move_reasons:
        explanation = (
            f"Final probability ({final_prob_a:.1%}) moved {total_move:+.1%} from the naive "
            f"weighted blend ({blend:.1%}) due to: {', '.join(move_reasons)}."
        )
    else:
        explanation = (
            f"Final probability ({final_prob_a:.1%}) matches the naive weighted blend exactly -- "
            f"no shrinkage, home bonus, or clamp applied."
        )

    return WinProbabilityResult(
        elo_prob_a=elo_prob_a,
        serve_return_prob_a=inputs.serve_return_prob_a,
        recent_form_prob_a=inputs.recent_form_prob_a,
        disagreement_std=disagreement_std,
        shrink_fraction_applied=shrink_fraction,
        blend_before_shrinkage=blend,
        prob_after_shrinkage=prob_after_shrinkage,
        prob_after_home_bonus=prob_after_home_bonus,
        final_prob_a=final_prob_a,
        tier_band=(lower, upper),
        was_clipped=was_clipped,
        warnings=warnings,
        explanation=explanation,
    )


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def print_result(result: WinProbabilityResult) -> None:
    print("--- Component probabilities (favoring Player A) ---")
    print(f"  Elo-derived:    {result.elo_prob_a:.3f}")
    print(f"  Serve/return:   {result.serve_return_prob_a:.3f}")
    print(f"  Recent form:    {result.recent_form_prob_a:.3f}")
    print(f"  Disagreement (std dev): {result.disagreement_std:.3f}")
    print()
    print("--- Blend and calibration steps ---")
    print(f"  Weighted blend (before shrinkage): {result.blend_before_shrinkage:.3f}")
    print(f"  After shrinkage ({result.shrink_fraction_applied:.0%} toward 0.5): {result.prob_after_shrinkage:.3f}")
    print(f"  After home-advantage bonus: {result.prob_after_home_bonus:.3f}")
    print(f"  Final probability (after tier clip [{result.tier_band[0]:.0%}, {result.tier_band[1]:.0%}]): "
          f"{result.final_prob_a:.3f}")
    print()
    if result.warnings:
        print("--- Validation warnings ---")
        for warning in result.warnings:
            print(f"  [!] {warning}")
    else:
        print("--- Validation warnings ---")
        print("  none")
    print()
    print("--- Explanation ---")
    print(f"  {result.explanation}")


# ---------------------------------------------------------------------------
# Test case from the spec
# ---------------------------------------------------------------------------


def run_demo() -> None:
    """Reproduces the exact test case from the spec: Elo actually favors Player B (1648 >
    1557), even though serve/return and recent form both favor Player A -- confirm the tool
    flags this rather than silently reporting a number that implies Elo agrees."""
    print("=== Demo: Elo favors Player B while other signals favor Player A ===\n")
    inputs = MatchInputs(
        player_a_surface_elo=1557,
        player_b_surface_elo=1648,
        serve_return_prob_a=0.64,
        recent_form_prob_a=0.52,
        weight_elo=0.33,
        weight_serve_return=0.32,
        weight_form=0.29,
        tier=Tier.CHALLENGER_ITF,
    )
    result = calculate_win_probability(inputs)
    print_result(result)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--demo", action="store_true", help="Run the built-in test case from the spec and exit.")
    parser.add_argument("--elo-a", type=float, help="Player A's surface Elo rating.")
    parser.add_argument("--elo-b", type=float, help="Player B's surface Elo rating.")
    parser.add_argument("--serve-return-a", type=float, help="Player A's serve/return-only win probability (0-1).")
    parser.add_argument("--recent-form-a", type=float, help="Player A's recent-form-only win probability (0-1).")
    parser.add_argument("--weight-elo", type=float, help="Weight for the Elo component (weights must sum to 1.0).")
    parser.add_argument("--weight-serve-return", type=float, help="Weight for the serve/return component.")
    parser.add_argument("--weight-form", type=float, help="Weight for the recent-form component.")
    parser.add_argument(
        "--tier",
        choices=[t.value for t in Tier],
        default=Tier.CHALLENGER_ITF.value,
        help="Match tier, controls the realism clamp. Default: challenger_itf.",
    )
    parser.add_argument("--data-quality", type=float, default=None, help="0-100. Needed to unlock the elite tier's 85% ceiling.")
    parser.add_argument("--home-advantage-bonus", type=float, default=None, help="Additive nudge, capped at +/-0.03.")
    parser.add_argument(
        "--predicted-set",
        action="append",
        dest="predicted_sets",
        metavar="GAMES_A-GAMES_B",
        help="Predicted set score, e.g. --predicted-set 6-4. Repeat per set.",
    )
    parser.add_argument("--upset-risk-label", choices=["LOW", "MEDIUM", "HIGH"], default=None)
    parser.add_argument("--historical-upset-rate-at-tier", type=float, default=None, help="0-1.")
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.demo or not any([args.elo_a, args.elo_b, args.serve_return_a, args.recent_form_a]):
        run_demo()
        return

    required = ["elo_a", "elo_b", "serve_return_a", "recent_form_a", "weight_elo", "weight_serve_return", "weight_form"]
    missing = [name for name in required if getattr(args, name) is None]
    if missing:
        parser.error(f"missing required arguments: {', '.join('--' + m.replace('_', '-') for m in missing)}")

    predicted_sets = None
    if args.predicted_sets:
        predicted_sets = []
        for raw in args.predicted_sets:
            try:
                a, b = raw.split("-")
                predicted_sets.append((int(a), int(b)))
            except ValueError:
                parser.error(f"invalid --predicted-set value {raw!r}, expected GAMES_A-GAMES_B (e.g. 6-4)")

    inputs = MatchInputs(
        player_a_surface_elo=args.elo_a,
        player_b_surface_elo=args.elo_b,
        serve_return_prob_a=args.serve_return_a,
        recent_form_prob_a=args.recent_form_a,
        weight_elo=args.weight_elo,
        weight_serve_return=args.weight_serve_return,
        weight_form=args.weight_form,
        tier=Tier(args.tier),
        data_quality=args.data_quality,
        home_advantage_bonus=args.home_advantage_bonus,
        predicted_sets=predicted_sets,
        upset_risk_label=args.upset_risk_label,
        historical_upset_rate_at_tier=args.historical_upset_rate_at_tier,
    )
    result = calculate_win_probability(inputs)
    print_result(result)


if __name__ == "__main__":
    main()
