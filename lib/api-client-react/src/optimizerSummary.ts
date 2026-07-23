import { useQuery } from "@tanstack/react-query";
import type { QueryFunction, QueryKey, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    if (key === "queryKey") continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
};

export interface OptimizerStrategyPick {
  id: number | null;
  name: string | null;
  status: string | null;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  createdAt: string | null;
}

export interface OptimizerAccuracySummaryResponse {
  production: {
    strategyName: string | null;
    strategyVersion: string | null;
    dateImplemented: string | null;
    lastValidationDate: string | null;
    overallAccuracy: number | null;
    walkForwardAccuracy: number | null;
    shadowReplayAccuracy: number | null;
    paperTradingAccuracy: number | null;
    liveGradedAccuracy: number | null;
    brierScore: number | null;
    logLoss: number | null;
    ece: number | null;
    calibrationError: number | null;
    coverage: number | null;
    abstentionRate: number | null;
    totalPredictions: number;
    totalGradedPredictions: number;
  };
  optimizer: {
    status: "idle" | "running" | "completed";
    lastRunAt: string | null;
    currentStage: string | null;
    strategiesGenerated: number;
    strategiesTested: number;
    uniqueStrategies: number;
    duplicateStrategiesRejected: number;
    strategiesAwaitingValidation: number;
    strategiesInShadowMode: number;
    challengers: number;
    archivedStrategies: number;
    failedStrategies: number;
    bestNewStrategy: OptimizerStrategyPick;
    bestHistoricalStrategy: OptimizerStrategyPick;
    largestAccuracyImprovement: number | null;
    largestBrierImprovement: number | null;
    largestLogLossImprovement: number | null;
    nextScheduledOptimizerRun: string | null;
  };
  comparison: {
    production: OptimizerStrategyPick;
    challenger: OptimizerStrategyPick;
  };
  bestByCategory: {
    currentProductionStrategy: OptimizerStrategyPick;
    currentChallengerStrategy: OptimizerStrategyPick;
    bestHistoricalStrategy: OptimizerStrategyPick;
    bestNewlyGeneratedStrategy: OptimizerStrategyPick;
    bestBySurface: OptimizerStrategyPick;
    bestByTourLevel: OptimizerStrategyPick;
    bestByCompetitiveBalanceTier: OptimizerStrategyPick;
    bestByEvidenceReliabilityTier: OptimizerStrategyPick;
    bestByRecommendationType: OptimizerStrategyPick;
    bestByCalibrationQuality: OptimizerStrategyPick;
    bestByRawWinnerAccuracy: OptimizerStrategyPick;
  };
  validation600: {
    sampleTarget: number;
    sampleSize: number;
    sampleReady: boolean;
    status: string;
    timestamp: string | null;
    datasetRangeStart: string | null;
    datasetRangeEnd: string | null;
    baseline: {
      accuracy: number | null;
      logLoss: number | null;
      brier: number | null;
      ece: number | null;
      coverage: number | null;
      abstentionRate: number | null;
      gradedRows: number;
    };
    candidate: {
      id: number | null;
      name: string | null;
      strategyVersion: string | null;
      status: string | null;
      accuracy: number | null;
      logLoss: number | null;
      brier: number | null;
      ece: number | null;
      coverage: number | null;
      abstentionRate: number | null;
    };
    deltas: {
      accuracy: number | null;
      logLoss: number | null;
      brier: number | null;
      ece: number | null;
    };
    tradesRejected: number | null;
    tradesRejectedEstimated: boolean;
    lossesAvoided: number | null;
    lossesAvoidedEstimated: boolean;
    promotionRecommendation: "Promote" | "Hold";
    limitation: string | null;
  };
  updatedAt: string;
}

export const getGetOptimizerAccuracySummaryUrl = () => `/api/evaluation/optimizer/summary`;

export const getOptimizerAccuracySummary = async (options?: RequestInit): Promise<OptimizerAccuracySummaryResponse> => {
  return customFetch<OptimizerAccuracySummaryResponse>(getGetOptimizerAccuracySummaryUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetOptimizerAccuracySummaryQueryKey = () => ["/api/evaluation/optimizer/summary"] as const;

export const getGetOptimizerAccuracySummaryQueryOptions = <
  TData = Awaited<ReturnType<typeof getOptimizerAccuracySummary>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getOptimizerAccuracySummary>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetOptimizerAccuracySummaryQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getOptimizerAccuracySummary>>> = ({ signal }) =>
    getOptimizerAccuracySummary({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getOptimizerAccuracySummary>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetOptimizerAccuracySummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getOptimizerAccuracySummary>>>;
export type GetOptimizerAccuracySummaryQueryError = ErrorType<unknown>;

export function useGetOptimizerAccuracySummary<
  TData = Awaited<ReturnType<typeof getOptimizerAccuracySummary>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getOptimizerAccuracySummary>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetOptimizerAccuracySummaryQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}
