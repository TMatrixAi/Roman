/**
 * Manual (non-generated) API hooks for the Backtesting Portal endpoints.
 * Follow the same TanStack Query + customFetch pattern as the generated hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UseMutationOptions,
  UseQueryOptions,
  MutationFunction,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BacktestDateRange {
  start: string;
  end: string;
}

export interface BacktestFilters {
  surface?: string;
  tour?: string;
  tournamentLevel?: string;
  bestOf?: number;
  includeRetirements?: boolean;
  includeWalkovers?: boolean;
  minCalibrated?: number;
  maxCalibrated?: number;
}

export interface BacktestPreviewResult {
  total: number;
  eligible: number;
  excluded: number;
  exclusionReasons: Record<string, number>;
}

export type BacktestStatus =
  | "queued"
  | "validating"
  | "preparing"
  | "running"
  | "training"
  | "generating-report"
  | "completed"
  | "completed-with-warnings"
  | "failed"
  | "cancelled";

export type BacktestMode = "evaluation" | "optimization";

export interface BacktestCalibrationBucket {
  label: string;
  n: number;
  observedAccuracy: number | null;
  avgPredicted: number | null;
}

export interface BacktestMetrics {
  n: number;
  accuracy: number | null;
  logLoss: number | null;
  brier: number | null;
  closeMatchAccuracy: number | null;
  retirementAdjustedAccuracy: number | null;
  retiredCount: number;
  voidCount: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  calibrationBuckets: BacktestCalibrationBucket[];
}

export interface BacktestRun {
  id: number;
  name: string;
  notes: string | null;
  status: BacktestStatus;
  mode: BacktestMode;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  dateRange: BacktestDateRange | null;
  filters: BacktestFilters | null;
  validationSetup: Record<string, string | null> | null;
  modelVersion: string | null;
  configVersion: string | null;
  datasetVersion: string | null;
  rowCounts: {
    total: number;
    eligible: number;
    excluded: number;
    exclusionReasons: Record<string, number>;
  } | null;
  processedRows: number;
  totalRows: number;
  currentStage: string | null;
  metrics: BacktestMetrics | null;
  errors: Array<{ message: string; code?: string; matchId?: string }> | null;
  candidateConfigId: number | null;
  deletedAt: string | null;
}

export interface BacktestPrediction {
  id: number;
  backtestRunId: number;
  historicalMatchId: string | null;
  player1Id: string;
  player1Name: string;
  player2Id: string;
  player2Name: string;
  surface: string | null;
  matchFormat: string | null;
  tournamentLevel: string | null;
  tournamentName: string | null;
  scheduledStartAt: string;
  modelVersion: string | null;
  rawProbability: number | null;
  calibratedProbability: number | null;
  predictedWinnerId: string | null;
  predictedWinnerName: string | null;
  actualWinnerId: string | null;
  actualWinnerName: string | null;
  resultType: string | null;
  includedInAccuracy: boolean;
  player1Won: boolean | null;
  featureSnapshot: unknown;
  createdAt: string;
}

export interface CandidateConfig {
  id: number;
  name: string;
  notes: string | null;
  status: string;
  sourceRunId: number | null;
  weightDiff: Record<string, unknown> | null;
  thresholdDiff: Record<string, unknown> | null;
  proposedConfig: Record<string, unknown> | null;
  holdoutMetrics: Record<string, unknown> | null;
  validationMetrics: Record<string, unknown> | null;
  acceptanceChecksPassed: boolean | null;
  acceptanceChecks: Array<{ check: string; passed: boolean; detail: string }> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBacktestInput {
  name: string;
  notes?: string;
  mode?: BacktestMode;
  dateRange: BacktestDateRange;
  filters?: BacktestFilters;
}

export interface ListBacktestPredictionsParams {
  limit?: number;
  offset?: number;
  surface?: string;
  resultType?: string;
  correct?: "true" | "false";
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const getListBacktestsQueryKey = () => ["backtests"] as const;
export const getBacktestQueryKey = (id: number) => ["backtests", id] as const;
export const getBacktestPredictionsQueryKey = (id: number, params?: ListBacktestPredictionsParams) =>
  ["backtests", id, "predictions", params] as const;
export const getListCandidateConfigsQueryKey = () => ["candidate-configs"] as const;
export const getCandidateConfigQueryKey = (id: number) => ["candidate-configs", id] as const;

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useListBacktests(options?: UseQueryOptions<BacktestRun[]>) {
  return useQuery<BacktestRun[]>({
    queryKey: getListBacktestsQueryKey(),
    queryFn: () => customFetch<BacktestRun[]>("/api/backtests"),
    refetchInterval: (query) => {
      // Poll every 3s when any run is active
      const data = query.state.data;
      const hasActive = data?.some((r) =>
        ["queued", "validating", "preparing", "running", "generating-report"].includes(r.status),
      );
      return hasActive ? 3000 : false;
    },
    ...options,
  });
}

export function useGetBacktest(id: number, options?: UseQueryOptions<BacktestRun>) {
  return useQuery<BacktestRun>({
    queryKey: getBacktestQueryKey(id),
    queryFn: () => customFetch<BacktestRun>(`/api/backtests/${id}`),
    enabled: !isNaN(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ["queued", "validating", "preparing", "running", "generating-report"].includes(status) ? 3000 : false;
    },
    ...options,
  });
}

export function useGetBacktestPredictions(
  id: number,
  params?: ListBacktestPredictionsParams,
  options?: UseQueryOptions<BacktestPrediction[]>,
) {
  const searchParams = new URLSearchParams();
  if (params?.limit != null) searchParams.set("limit", String(params.limit));
  if (params?.offset != null) searchParams.set("offset", String(params.offset));
  if (params?.surface) searchParams.set("surface", params.surface);
  if (params?.resultType) searchParams.set("resultType", params.resultType);
  if (params?.correct) searchParams.set("correct", params.correct);
  const qs = searchParams.toString();

  return useQuery<BacktestPrediction[]>({
    queryKey: getBacktestPredictionsQueryKey(id, params),
    queryFn: () => customFetch<BacktestPrediction[]>(`/api/backtests/${id}/predictions${qs ? `?${qs}` : ""}`),
    enabled: !isNaN(id),
    ...options,
  });
}

export function usePreviewBacktest() {
  return useMutation<BacktestPreviewResult, Error, { dateRange: BacktestDateRange; filters?: BacktestFilters }>({
    mutationFn: (body) =>
      customFetch<BacktestPreviewResult>("/api/backtests/preview", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateBacktest(
  options?: UseMutationOptions<BacktestRun, Error, CreateBacktestInput>,
) {
  const queryClient = useQueryClient();
  return useMutation<BacktestRun, Error, CreateBacktestInput>({
    mutationFn: (body) =>
      customFetch<BacktestRun>("/api/backtests", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBacktestsQueryKey() }),
    ...options,
  });
}

export function useCancelBacktest(
  options?: UseMutationOptions<{ ok: boolean }, Error, number>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (id) =>
      customFetch<{ ok: boolean }>(`/api/backtests/${id}/cancel`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBacktestsQueryKey() }),
    ...options,
  });
}

export function useDeleteBacktest(
  options?: UseMutationOptions<{ ok: boolean }, Error, number>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (id) =>
      customFetch<{ ok: boolean }>(`/api/backtests/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBacktestsQueryKey() }),
    ...options,
  });
}

// ─── Task #64: live backfill progress polling ─────────────────────────────────

export interface BackfillLiveProgress {
  isRunning: boolean;
  activeJobId: number | null;
  activeStartedAt: string | null;
  activeDateRange: { dateStart: string; dateStop: string } | null;
  lastCompletedStatus: string | null;
  lastCompletedAt: string | null;
}

export const getBackfillLiveProgressQueryKey = () => ["backfill-live-progress"] as const;

/**
 * Polls the live backfill status every 5 s when `triggeredAt` is set.
 * Pass the ISO timestamp of when the trigger fired. Stops auto-polling once
 * `isRunning` transitions to false (server found a completed row after triggeredAt).
 */
export function useGetBackfillLiveProgress(options?: { triggeredAt?: string | null }) {
  const { triggeredAt } = options ?? {};
  const enabled = !!triggeredAt;
  const qs = triggeredAt ? `?triggeredAt=${encodeURIComponent(triggeredAt)}` : "";
  return useQuery<BackfillLiveProgress>({
    queryKey: [...getBackfillLiveProgressQueryKey(), triggeredAt],
    queryFn: () =>
      customFetch<BackfillLiveProgress>(`/api/evaluation/historical-backfill/live-progress${qs}`),
    enabled,
    refetchInterval: (query) => {
      return query.state.data?.isRunning ? 5000 : false;
    },
    refetchIntervalInBackground: true,
  });
}

// ─── Candidate configs ────────────────────────────────────────────────────────

export function useListCandidateConfigs(options?: UseQueryOptions<CandidateConfig[]>) {
  return useQuery<CandidateConfig[]>({
    queryKey: getListCandidateConfigsQueryKey(),
    queryFn: () => customFetch<CandidateConfig[]>("/api/candidate-configs"),
    ...options,
  });
}

export function useUpdateCandidateConfig(
  options?: UseMutationOptions<CandidateConfig, Error, { id: number; data: Partial<Pick<CandidateConfig, "name" | "notes" | "status">> }>,
) {
  const queryClient = useQueryClient();
  return useMutation<CandidateConfig, Error, { id: number; data: Partial<Pick<CandidateConfig, "name" | "notes" | "status">> }>({
    mutationFn: ({ id, data }) =>
      customFetch<CandidateConfig>(`/api/candidate-configs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListCandidateConfigsQueryKey() });
    },
    ...options,
  });
}

export function useDeleteCandidateConfig(
  options?: UseMutationOptions<{ ok: boolean }, Error, number>,
) {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (id) =>
      customFetch<{ ok: boolean }>(`/api/candidate-configs/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListCandidateConfigsQueryKey() }),
    ...options,
  });
}
