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

export interface CandidateConfigRecord {
  id: number;
  strategyId: string | null;
  strategyVersion: string | null;
  strategyName: string | null;
  strategyFamily: string | null;
  strategyFingerprint: string | null;
  parentStrategyId: string | null;
  parentStrategyVersion: string | null;
  creationMethod: string | null;
  optimizerRunId: string | null;
  lastTestedAt: string | null;
  productionStatus: string | null;
  lifecycleStatus: string | null;
  validationStatus: string | null;
  walkForwardStatus: string | null;
  shadowStatus: string | null;
  featureSet: Record<string, unknown> | null;
  weights: Record<string, unknown> | null;
  thresholds: Record<string, unknown> | null;
  calibrationMethod: string | null;
  specialistRouting: string | null;
  competitiveBalanceBehavior: Record<string, unknown> | null;
  evidenceReliabilityBehavior: Record<string, unknown> | null;
  abstentionRules: Record<string, unknown> | null;
  recommendationGates: Record<string, unknown> | null;
  promotedAt: string | null;
  promotedBy: string | null;
  rollbackStrategyId: string | null;
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

export const getCandidateConfigs = async (options?: RequestInit): Promise<CandidateConfigRecord[]> => {
  return customFetch<CandidateConfigRecord[]>("/api/backtests/candidate-configs", {
    ...options,
    method: "GET",
  });
};

export const getCandidateConfigsQueryKey = () => ["/api/backtests/candidate-configs"] as const;

export const getCandidateConfigsQueryOptions = <
  TData = Awaited<ReturnType<typeof getCandidateConfigs>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getCandidateConfigs>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getCandidateConfigsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getCandidateConfigs>>> = ({ signal }) =>
    getCandidateConfigs({ signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getCandidateConfigs>>, TError, TData> & { queryKey: QueryKey };
};

export type CandidateConfigsQueryResult = NonNullable<Awaited<ReturnType<typeof getCandidateConfigs>>>;
export type CandidateConfigsQueryError = ErrorType<unknown>;

export function useGetCandidateConfigs<TData = Awaited<ReturnType<typeof getCandidateConfigs>>, TError = ErrorType<unknown>>(
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getCandidateConfigs>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getCandidateConfigsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}
