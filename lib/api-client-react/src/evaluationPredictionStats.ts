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

export interface EvaluationPredictionStatsParams {
  runKind?: "historical_test" | "paper_trade" | "live";
}

export interface EvaluationPredictionStats {
  totalPredictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  accuracy: number | null;
  byRecommendation: Array<{
    recommendation: "STRONG_RECOMMENDATION" | "MODERATE_LEAN" | "HIGH_RISK" | "NO_STRONG_SIGNAL" | "DO_NOT_RECOMMEND";
    count: number;
  }>;
}

export const getEvaluationPredictionStats = async (params?: EvaluationPredictionStatsParams, options?: RequestInit): Promise<EvaluationPredictionStats> => {
  const normalizedParams = new URLSearchParams();
  if (params?.runKind) normalizedParams.set("runKind", params.runKind);
  const query = normalizedParams.toString();
  const url = query.length > 0 ? `/api/evaluation/predictions/stats?${query}` : `/api/evaluation/predictions/stats`;
  return customFetch<EvaluationPredictionStats>(url, { ...options, method: "GET" });
};

export const getEvaluationPredictionStatsQueryKey = (params?: EvaluationPredictionStatsParams) => ["/api/evaluation/predictions/stats", ...(params ? [params] : [])] as const;

export const getEvaluationPredictionStatsQueryOptions = <TData = Awaited<ReturnType<typeof getEvaluationPredictionStats>>, TError = ErrorType<unknown>>(params?: EvaluationPredictionStatsParams, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getEvaluationPredictionStats>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getEvaluationPredictionStatsQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getEvaluationPredictionStats>>> = ({ signal }) => getEvaluationPredictionStats(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getEvaluationPredictionStats>>, TError, TData> & { queryKey: QueryKey };
};

export type GetEvaluationPredictionStatsQueryResult = NonNullable<Awaited<ReturnType<typeof getEvaluationPredictionStats>>>;
export type GetEvaluationPredictionStatsQueryError = ErrorType<unknown>;

export function useGetEvaluationPredictionStats<TData = Awaited<ReturnType<typeof getEvaluationPredictionStats>>, TError = ErrorType<unknown>>(params?: EvaluationPredictionStatsParams, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getEvaluationPredictionStats>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getEvaluationPredictionStatsQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}