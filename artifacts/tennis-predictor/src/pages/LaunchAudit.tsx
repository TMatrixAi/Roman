import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueries } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  RefreshCw,
  ShieldCheck,
  Activity,
  Database,
  RadioTower,
  Clock3,
  AlertCircle,
  Loader2,
  ListFilter,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useLiveAuditsAccess } from '@/hooks/useLiveAuditsAccess';
import {
  getLiveAuditsOverview,
  getLiveAuditsSection,
  normalizeStatus,
  postLiveAuditsAction,
  runFullLaunchAudit,
  type LaunchAuditSummary,
  type LiveAuditsRequestResult,
  type LiveAuditsStatus,
} from '@/lib/liveAuditsApi';

const SECTION_CONFIG = [
  { key: 'overview', label: 'Overview' },
  { key: 'system-health', label: 'System Health' },
  { key: 'testing-center', label: 'Testing Center' },
  { key: 'deployment-checks', label: 'Deployment Checks' },
  { key: 'monitoring-alerts', label: 'Monitoring & Alerts' },
  { key: 'performance', label: 'Performance' },
  { key: 'error-logs', label: 'Error Logs' },
  { key: 'rollback-recovery', label: 'Rollback & Recovery' },
  { key: 'database-health', label: 'Database Health' },
  { key: 'prediction-engine-health', label: 'Prediction Engine Health' },
  { key: 'api-status', label: 'API Status' },
  { key: 'background-jobs', label: 'Background Jobs' },
  { key: 'audit-history', label: 'Audit History' },
] as const;

type SectionKey = (typeof SECTION_CONFIG)[number]['key'];

function statusTone(status: string | undefined) {
  switch (normalizeStatus(status)) {
    case 'Healthy':
      return 'bg-primary/10 text-primary border-primary/35';
    case 'Warning':
      return 'bg-warning/10 text-warning border-warning/40';
    case 'Critical':
      return 'bg-destructive/10 text-destructive border-destructive/40';
    case 'Running':
      return 'bg-secondary text-secondary-foreground border-border/50';
    default:
      return 'bg-secondary text-secondary-foreground border-border/50';
  }
}

function statusLabel(status: string | undefined): LiveAuditsStatus {
  return normalizeStatus(status);
}

function formatMaybeDate(value: string | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function overallStatusClass(status: string | undefined) {
  const mapped = statusLabel(status);
  if (mapped === 'Healthy') return 'text-primary drop-shadow-[0_0_10px_hsl(var(--primary)/0.45)]';
  if (mapped === 'Warning') return 'text-warning';
  if (mapped === 'Critical') return 'text-destructive';
  if (mapped === 'Running') return 'text-secondary-foreground';
  return 'text-foreground';
}

function getResultMessage<T>(result: LiveAuditsRequestResult<T> | undefined) {
  if (!result) return null;
  if (result.status === 'success') return null;
  if (result.status === 'not-configured') return 'Not configured';
  if (result.status === 'unauthorized') return 'Unauthorized';
  if (result.status === 'forbidden') return 'Forbidden';
  if (result.status === 'timeout') return result.message ?? 'Request timed out';
  return result.message ?? 'Request failed';
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{message}</div>;
}

function SectionState({
  loading,
  error,
  result,
  emptyMessage,
}: {
  loading: boolean;
  error: unknown;
  result?: LiveAuditsRequestResult<Record<string, unknown>>;
  emptyMessage: string;
}) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (error) return <EmptyState message="Failed to load this section." />;

  const message = getResultMessage(result);
  if (message) return <EmptyState message={message} />;

  if (!result?.data) return <EmptyState message={emptyMessage} />;
  return null;
}

function MobileSectionNav() {
  return (
    <TabsList className="sticky top-[4.7rem] z-20 mt-1 w-full justify-start gap-1 overflow-x-auto rounded-xl border-border/70 bg-background/95 px-1 py-1">
      {SECTION_CONFIG.map((section) => (
        <TabsTrigger
          key={section.key}
          value={section.key}
          className="h-9 min-w-max px-3 text-xs"
          aria-label={`Open ${section.label}`}
        >
          {section.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

export default function LaunchAuditPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<SectionKey>('overview');
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState('');
  const [logPage, setLogPage] = useState(1);

  const accessQuery = useLiveAuditsAccess();

  const overviewQuery = useQuery({
    queryKey: ['live-audits-overview'],
    queryFn: () => getLiveAuditsOverview(),
    enabled: accessQuery.data?.canAccessLiveAudits === true,
    refetchInterval: 60_000,
  });

  const runFullAuditMutation = useMutation({
    mutationFn: () => runFullLaunchAudit(),
    onSuccess: (result) => {
      setActionFeedback(
        result.status === 'success'
          ? `Launch audit started from ${result.endpoint ?? 'server endpoint'}`
          : `Launch audit request did not complete: ${getResultMessage(result)}`,
      );
      void overviewQuery.refetch();
    },
    onError: (error) => {
      setActionFeedback(error instanceof Error ? error.message : 'Failed to run launch audit');
    },
  });

  useEffect(() => {
    if (overviewQuery.data?.status === 'success') {
      setLastRefreshAt(new Date().toISOString());
    }
  }, [overviewQuery.data]);

  useEffect(() => {
    if (!accessQuery.data?.canAccessLiveAudits) return;

    const currentStatus = overviewQuery.data?.data?.status ?? overviewQuery.data?.data?.overallStatus;
    if (statusLabel(currentStatus) !== 'Running') return;

    const poller = window.setInterval(() => {
      void overviewQuery.refetch();
    }, 5000);

    return () => window.clearInterval(poller);
  }, [accessQuery.data?.canAccessLiveAudits, overviewQuery]);

  const sectionQueries = useQueries({
    queries: SECTION_CONFIG.filter((section) => section.key !== 'overview').map((section) => ({
      queryKey: ['live-audits-section', section.key],
      queryFn: () => getLiveAuditsSection(section.key),
      enabled: accessQuery.data?.canAccessLiveAudits === true,
      staleTime: 20_000,
    })),
  });

  const sectionMap = useMemo(() => {
    const pairs = SECTION_CONFIG.filter((section) => section.key !== 'overview').map((section, idx) => [
      section.key,
      sectionQueries[idx],
    ] as const);
    return Object.fromEntries(pairs) as Record<Exclude<SectionKey, 'overview'>, (typeof sectionQueries)[number]>;
  }, [sectionQueries]);

  const summary: LaunchAuditSummary | null = overviewQuery.data?.status === 'success' ? overviewQuery.data.data ?? null : null;
  const loading = overviewQuery.isPending;
  const running = runFullAuditMutation.isPending;
  const topFindings = useMemo(() => summary?.findings.slice(0, 4) ?? [], [summary]);
  const history = useMemo(() => summary?.history ?? [], [summary]);

  const performAction = async (actionId: string, actionPath: string, payload?: Record<string, unknown>) => {
    if (runningActionId) return;
    setRunningActionId(actionId);
    setActionFeedback(null);
    const result = await postLiveAuditsAction(actionPath, payload);
    if (result.status === 'success') {
      setActionFeedback('Action completed successfully.');
      await Promise.all([overviewQuery.refetch(), ...sectionQueries.map((query) => query.refetch())]);
    } else {
      setActionFeedback(getResultMessage(result) ?? 'Action failed');
    }
    setRunningActionId(null);
  };

  if (accessQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!accessQuery.data?.canAccessLiveAudits) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Lock className="h-5 w-5" /> Access Restricted
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Live Audits is available only in the Admin / Developer area for Owner, Admin, and Developer roles.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocation('/')}>
              Return to Dashboard
            </Button>
            <Button onClick={() => setLocation('/admin/login')}>Admin Login</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <ShieldCheck className="w-4 h-4" />
            Developer / Admin
          </div>
          <h1 className="text-3xl font-display font-bold">Live Audits</h1>
          <p className="text-muted-foreground">Central production-readiness and engineering operations interface.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([overviewQuery.refetch(), ...sectionQueries.map((query) => query.refetch())]);
            }}
            disabled={loading}
            className="gap-2"
            aria-label="Refresh live audits data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => runFullAuditMutation.mutate()}
            disabled={running}
            className="gap-2"
            variant="default"
            aria-label="Run full launch audit"
          >
            <Activity className="w-4 h-4" />
            {running ? 'Running...' : 'Run Full Launch Audit'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground md:text-sm" role="status" aria-live="polite">
        <span className="font-semibold text-foreground">Last refresh:</span> {lastRefreshAt ? formatMaybeDate(lastRefreshAt) : 'Not yet refreshed'}
        {actionFeedback ? <span className="ml-3">{actionFeedback}</span> : null}
      </div>

      {getResultMessage(overviewQuery.data) ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState message={`Overview load failed: ${getResultMessage(overviewQuery.data)}`} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Overall Status</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className={`flex items-center gap-2 text-xl font-semibold ${overallStatusClass(summary?.overallStatus)}`}>
                {statusLabel(summary?.overallStatus)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Findings</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : <div className="text-xl font-semibold">{summary?.failCount ?? 0} failed / {summary?.warningCount ?? 0} warnings</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : <div className="text-xl font-semibold">{summary?.criticalCount ?? 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">High</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : <div className="text-xl font-semibold">{summary?.highCount ?? 0}</div>}
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SectionKey)}>
        <MobileSectionNav />

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RadioTower className="w-5 h-5" /> Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topFindings.length === 0 ? (
                  <EmptyState message="No provider checks loaded yet." />
                ) : (
                  topFindings.map((finding) => (
                    <div key={`${finding.category}-${finding.checkName}`} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">{finding.checkName}</div>
                          <div className="text-xs text-muted-foreground">{finding.relatedService}</div>
                        </div>
                        <Badge variant="outline" className={statusTone(finding.status)}>
                          {statusLabel(finding.status)}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">{finding.evidence}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Production Snapshot
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border p-4">
                  <div className="font-medium">Frontend status</div>
                  <p className="mt-1 text-muted-foreground">{statusLabel(summary?.findings.find((f) => /frontend/i.test(f.checkName))?.status)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="font-medium">Backend/API status</div>
                  <p className="mt-1 text-muted-foreground">{statusLabel(summary?.findings.find((f) => /backend|api/i.test(f.checkName))?.status)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="font-medium">Database status</div>
                  <p className="mt-1 text-muted-foreground">{statusLabel(summary?.findings.find((f) => /database/i.test(f.checkName))?.status)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="font-medium">Current warnings / critical errors</div>
                  <p className="mt-1 text-muted-foreground">
                    {summary?.warningCount ?? 0} warnings, {summary?.criticalCount ?? 0} critical
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BadgeCheck className="w-5 h-5" /> Recent Findings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loading ? (
                  <Skeleton className="h-14 w-full" />
                ) : summary?.findings.length ? (
                  summary.findings.map((finding) => (
                    <div key={`${finding.category}-${finding.checkName}-${finding.timestamp}`} className="flex flex-col gap-1 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-medium">{finding.checkName}</div>
                        <div className="text-sm text-muted-foreground">{finding.evidence}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={statusTone(finding.status)}>
                          {statusLabel(finding.status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{finding.category}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState message="No findings available yet." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock3 className="w-5 h-5" /> Audit History
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loading ? (
                  <Skeleton className="h-14 w-full" />
                ) : history.length ? (
                  history.map((entry) => (
                    <div key={entry.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{statusLabel(entry.overallStatus)}</div>
                        <Badge variant="outline">{entry.passCount} pass</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatMaybeDate(entry.completedAt)} · {entry.failCount} failed / {entry.warningCount} warnings
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState message="No historical audits yet." />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="system-health">
          <Card>
            <CardHeader>
              <CardTitle>System Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SectionState loading={sectionMap['system-health'].isPending} error={sectionMap['system-health'].error} result={sectionMap['system-health'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="System health data is unavailable." />
              {summary?.findings.map((finding) => (
                <div key={`health-${finding.checkName}-${finding.timestamp}`} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{finding.checkName}</div>
                    <Badge variant="outline" className={statusTone(finding.status)}>{statusLabel(finding.status)}</Badge>
                  </div>
                  <div className="mt-1 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                    <div>Component: {finding.relatedService}</div>
                    <div>Last checked: {formatMaybeDate(finding.timestamp)}</div>
                    <div>Response time: {typeof finding.responseTimeMs === 'number' ? `${finding.responseTimeMs} ms` : 'Unknown'}</div>
                    <div>Failure reason: {finding.failureReason ?? finding.actualResult ?? 'Unknown'}</div>
                  </div>
                  {accessQuery.data.permissions.canRetrySafeJobs ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={runningActionId === `retry-${finding.checkName}`}
                        onClick={() => {
                          void performAction(`retry-${finding.checkName}`, 'system-health/retry', { component: finding.relatedService });
                        }}
                      >
                        {runningActionId === `retry-${finding.checkName}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testing-center">
          <Card>
            <CardHeader>
              <CardTitle>Testing Center</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['testing-center'].isPending} error={sectionMap['testing-center'].error} result={sectionMap['testing-center'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Testing center is not configured." />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {['full', 'e2e', 'integrity', 'regression', 'type-check', 'build-check', 'mobile'].map((suite) => (
                  <Button
                    key={suite}
                    variant="outline"
                    disabled={!accessQuery.data.permissions.canRunAudits || runningActionId === `test-${suite}`}
                    onClick={() => {
                      void performAction(`test-${suite}`, 'testing-center/run', { suite });
                    }}
                    className="justify-start"
                  >
                    {runningActionId === `test-${suite}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Run {suite === 'e2e' ? 'End-to-End Tests' : suite.replace('-', ' ')}
                  </Button>
                ))}
              </div>
              <EmptyState message="When unavailable, backend should return Not configured for each suite." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deployment-checks">
          <Card>
            <CardHeader>
              <CardTitle>Deployment Checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['deployment-checks'].isPending} error={sectionMap['deployment-checks'].error} result={sectionMap['deployment-checks'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Deployment checks are not configured." />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Button
                  variant="outline"
                  disabled={!accessQuery.data.permissions.canRunAudits || runningActionId === 'pre-deploy'}
                  onClick={() => {
                    void performAction('pre-deploy', 'deployment-checks/pre-deploy/run');
                  }}
                >
                  {runningActionId === 'pre-deploy' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Run Pre-Deployment Audit
                </Button>
                <Button
                  variant="outline"
                  disabled={!accessQuery.data.permissions.canRunAudits || runningActionId === 'post-deploy'}
                  onClick={() => {
                    void performAction('post-deploy', 'deployment-checks/post-deploy-smoke/run');
                  }}
                >
                  {runningActionId === 'post-deploy' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Run Post-Deployment Smoke Test
                </Button>
                <Button
                  disabled={!accessQuery.data.permissions.canRunAudits || running}
                  onClick={() => runFullAuditMutation.mutate()}
                >
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Run Full Launch Audit
                </Button>
              </div>
              <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                Audit ID: {summary?.auditId ?? 'Unknown'} · Commit: {summary?.commit ?? 'Unknown'} · Version: {summary?.version ?? 'Unknown'}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monitoring-alerts">
          <Card>
            <CardHeader>
              <CardTitle>Monitoring & Alerts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['monitoring-alerts'].isPending} error={sectionMap['monitoring-alerts'].error} result={sectionMap['monitoring-alerts'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Alert configuration is unavailable." />
              {accessQuery.data.permissions.canManageAlerts ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void performAction('alerts-refresh', 'monitoring-alerts/refresh')}>Refresh alert config</Button>
                  <Button variant="outline" onClick={() => void performAction('alerts-history', 'monitoring-alerts/history')}>View alert history</Button>
                </div>
              ) : (
                <EmptyState message="You can view alert states but cannot modify alert configuration with this role." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle>Performance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['performance'].isPending} error={sectionMap['performance'].error} result={sectionMap['performance'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Performance metrics are unavailable." />
              {accessQuery.data.permissions.canRunPerformanceTests ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button>Run Approved Performance Test</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Run performance test?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This test can temporarily increase system load. Continue only during a safe maintenance window.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void performAction('performance-test', 'performance/run-approved-test');
                        }}
                      >
                        Confirm
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="error-logs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListFilter className="h-5 w-5" /> Error Logs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['error-logs'].isPending} error={sectionMap['error-logs'].error} result={sectionMap['error-logs'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Error log viewer is not configured." />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={logSearch}
                  onChange={(event) => {
                    setLogSearch(event.target.value);
                    setLogPage(1);
                  }}
                  placeholder="Filter logs by severity, source, request ID"
                  aria-label="Filter error logs"
                />
                <Button variant="outline" onClick={() => void performAction('logs-refresh', 'error-logs/search', { query: logSearch, page: logPage })}>
                  Search logs
                </Button>
              </div>
              <EmptyState message="Log entries should provide timestamp, severity, source, message, stack trace (when available), and resolution status." />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setLogPage((prev) => prev + 1)}>
                  Load More
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rollback-recovery">
          <Card>
            <CardHeader>
              <CardTitle>Rollback & Recovery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['rollback-recovery'].isPending} error={sectionMap['rollback-recovery'].error} result={sectionMap['rollback-recovery'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Rollback and recovery data is not configured." />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => void performAction('restore-point', 'rollback-recovery/create-restore-point')}>Create Restore Point</Button>
                <Button variant="outline" onClick={() => void performAction('recovery-check', 'rollback-recovery/run-recovery-check')}>Run Recovery Check</Button>
              </div>
              {accessQuery.data.permissions.canRunDestructiveRollback ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">Roll Back to Previous Stable Version</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm rollback</AlertDialogTitle>
                      <AlertDialogDescription>
                        Current version, target version, commit delta, and migration compatibility are validated by backend before execution.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void performAction('rollback', 'rollback-recovery/rollback');
                        }}
                      >
                        Confirm rollback
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="database-health">
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2"><Database className="h-5 w-5" /> Database Health</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['database-health'].isPending} error={sectionMap['database-health'].error} result={sectionMap['database-health'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Database health checks are unavailable." />
              {accessQuery.data.permissions.canRunDestructiveRepairs ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">Run Destructive Repair</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm destructive repair</AlertDialogTitle>
                      <AlertDialogDescription>
                        This operation may change or remove records. Continue only after reviewing impacted record counts.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void performAction('db-repair', 'database-health/destructive-repair');
                        }}
                      >
                        Confirm repair
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prediction-engine-health">
          <Card>
            <CardHeader>
              <CardTitle>Prediction Engine Health</CardTitle>
            </CardHeader>
            <CardContent>
              <SectionState loading={sectionMap['prediction-engine-health'].isPending} error={sectionMap['prediction-engine-health'].error} result={sectionMap['prediction-engine-health'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Prediction engine diagnostics are unavailable." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-status">
          <Card>
            <CardHeader>
              <CardTitle>API Status</CardTitle>
            </CardHeader>
            <CardContent>
              <SectionState loading={sectionMap['api-status'].isPending} error={sectionMap['api-status'].error} result={sectionMap['api-status'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="API provider status is unavailable." />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="background-jobs">
          <Card>
            <CardHeader>
              <CardTitle>Background Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SectionState loading={sectionMap['background-jobs'].isPending} error={sectionMap['background-jobs'].error} result={sectionMap['background-jobs'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Background job telemetry is unavailable." />
              <Button
                variant="outline"
                disabled={!accessQuery.data.permissions.canRetrySafeJobs || runningActionId === 'retry-job'}
                onClick={() => {
                  void performAction('retry-job', 'background-jobs/retry-safe-job');
                }}
              >
                {runningActionId === 'retry-job' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Retry Safe Job
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit-history">
          <Card>
            <CardHeader>
              <CardTitle>Audit History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SectionState loading={sectionMap['audit-history'].isPending} error={sectionMap['audit-history'].error} result={sectionMap['audit-history'].data as LiveAuditsRequestResult<Record<string, unknown>> | undefined} emptyMessage="Persisted audit history is unavailable." />
              {history.length ? (
                history.map((entry) => (
                  <div key={`summary-history-${entry.id}`} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{statusLabel(entry.overallStatus)}</div>
                      <Badge variant="outline">{entry.passCount} passed</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Started/Completed: {formatMaybeDate(entry.completedAt)} · Failures: {entry.failCount} · Warnings: {entry.warningCount}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Commit: {entry.commit ?? 'Unknown'} · Version: {entry.version ?? 'Unknown'}</div>
                  </div>
                ))
              ) : (
                <EmptyState message="No persisted launch audit history entries returned yet." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span className="font-medium text-foreground">Role:</span> {accessQuery.data.role} ·
        <span className="ml-1 font-medium text-foreground">Logs:</span> {accessQuery.data.permissions.canViewLogs ? 'Allowed' : 'Restricted'} ·
        <span className="ml-1 font-medium text-foreground">Rollback:</span> {accessQuery.data.permissions.canRunDestructiveRollback ? 'Allowed' : 'Restricted'}
      </div>
    </div>
  );
}
