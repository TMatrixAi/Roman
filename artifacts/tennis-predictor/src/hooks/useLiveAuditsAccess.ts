import { useQuery } from '@tanstack/react-query';
import { getLiveAuditsAccess } from '@/lib/liveAuditsApi';

export function useLiveAuditsAccess() {
  return useQuery({
    queryKey: ['liveAuditsAccess'],
    queryFn: getLiveAuditsAccess,
    staleTime: 1000 * 60,
    retry: 1,
  });
}
