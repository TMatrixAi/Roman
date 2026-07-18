import { customFetch } from "./custom-fetch";
import { useMutation } from "@tanstack/react-query";

export interface RankingDiscrepancy {
  playerId: string;
  playerName: string;
  storedRank: number | null;
  providerRank: number;
  gapPlaces: number;
}

export interface RankingVerificationResult {
  computedAt: string;
  totalProviderRankings: number;
  totalStoredPlayers: number;
  discrepancies: RankingDiscrepancy[];
}

export function getRunRankingVerificationMutationKey() {
  return ["ranking-verification", "run"] as const;
}

/**
 * Triggers a ranking-verification run (POST /evaluation/ranking-verification).
 * Each call fetches live ATP/WTA standings from the provider — use sparingly.
 * `customFetch` throws on non-2xx, so `useMutation` surfaces errors via `isError`.
 */
export function useRunRankingVerification() {
  return useMutation<RankingVerificationResult, Error>({
    mutationKey: getRunRankingVerificationMutationKey(),
    mutationFn: () =>
      customFetch<RankingVerificationResult>("/api/evaluation/ranking-verification", { method: "POST" }),
  });
}
