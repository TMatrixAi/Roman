import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { AlertTriangle, BadgeCheck, CheckCircle2, RefreshCw, ShieldCheck, Activity, Database, RadioTower, Clock3, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface LaunchAuditSummary {
  overallStatus: 'Ready' | 'Ready With Warnings' | 'Not Ready' | 'Audit Incomplete';
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  findings: Array<{
    category: string;
    checkName: string;
    status: string;
    severity: string;
    evidence: string;
    expectedResult: string;
    actualResult: string;
    recommendedAction: string;
    relatedService: string;
    timestamp: string;
  }>;
  history?: Array<{
    id: string;
    completedAt: string;
    overallStatus: string;
    passCount: number;
    warningCount: number;
    failCount: number;
    criticalCount: number;
    highCount: number;
    reportPath: string;
  }>;
}

function statusTone(status: string) {
  switch (status) {
    case 'Pass':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
    case 'Warning':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'Fail':
      return 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20';
    default:
      return 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20';
  }
}

export default function LaunchAuditPage() {
  const [, setLocation] = useLocation();
  const [summary, setSummary] = useState<LaunchAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/launch-audit/summary', { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Unable to load launch audit');
      }
      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error(error);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
    const timer = window.setInterval(() => {
      void loadSummary();
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  const topFindings = useMemo(() => summary?.findings.slice(0, 4) ?? [], [summary]);
  const history = useMemo(() => summary?.history ?? [], [summary]);

  const runAudit = async () => {
    setRunning(true);
    try {
      const response = await fetch('/api/launch-audit/run', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Unable to run launch audit');
      }
      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error(error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <ShieldCheck className="w-4 h-4" />
            Developer / Admin
          </div>
          <h1 className="text-3xl font-display font-bold">Launch Audit</h1>
          <p className="text-muted-foreground">Run a complete production-readiness check and monitor live provider health.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadSummary()} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => void runAudit()} disabled={running} className="gap-2">
            <Activity className="w-4 h-4" />
            {running ? 'Running...' : 'Run Full Launch Audit'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Overall Status</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-24" /> : <div className="flex items-center gap-2 text-xl font-semibold">{summary?.overallStatus ?? 'Audit Incomplete'}</div>}
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

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RadioTower className="w-5 h-5" /> Live API Monitoring
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topFindings.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No provider checks loaded yet.</div>
            ) : (
              topFindings.map((finding) => (
                <div key={`${finding.category}-${finding.checkName}`} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{finding.checkName}</div>
                      <div className="text-xs text-muted-foreground">{finding.relatedService}</div>
                    </div>
                    <Badge variant="outline" className={statusTone(finding.status)}>{finding.status}</Badge>
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
              <AlertTriangle className="w-5 h-5" /> Audit Highlights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Database className="w-4 h-4" /> Data & integration checks
              </div>
              <p className="mt-2 text-sm text-muted-foreground">The page now surfaces a lightweight readiness snapshot and provider status summary for admin users.</p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock3 className="w-4 h-4" /> Refresh cadence
              </div>
              <p className="mt-2 text-sm text-muted-foreground">The summary refreshes automatically every 60 seconds and can also be refreshed manually.</p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="w-4 h-4" /> Access control
              </div>
              <p className="mt-2 text-sm text-muted-foreground">This page is protected by the existing admin-session guard.</p>
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
                    <Badge variant="outline" className={statusTone(finding.status)}>{finding.status}</Badge>
                    <span className="text-xs text-muted-foreground">{finding.category}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No findings available yet.</div>
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
                    <div className="font-medium">{entry.overallStatus}</div>
                    <Badge variant="outline">{entry.passCount} pass</Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {new Date(entry.completedAt).toLocaleString()} · {entry.failCount} failed / {entry.warningCount} warnings
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No historical audits yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
