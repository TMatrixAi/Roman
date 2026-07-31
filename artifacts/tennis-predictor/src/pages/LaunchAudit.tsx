import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Activity,
  Database,
  RadioTower,
  Clock3,
  AlertCircle,
  XCircle,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  Filter,
  Zap,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LaunchAuditFinding {
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
}

interface ProviderHealthCard {
  name: string;
  category: string;
  role: string;
  status: string;
  keyConfigured: boolean;
  lastCallAt: string | null;
  lastError: string | null;
  details: string;
}

interface LaunchAuditSummary {
  overallStatus: 'Ready' | 'Ready With Warnings' | 'Not Ready' | 'Audit Incomplete';
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  findings: LaunchAuditFinding[];
  providers: ProviderHealthCard[];
  generatedAt?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function overallStatusStyle(status: LaunchAuditSummary['overallStatus'] | undefined) {
  if (status === 'Ready') return { text: 'text-primary', bg: 'bg-primary/10 border-primary/30', icon: CheckCircle2 };
  if (status === 'Ready With Warnings') return { text: 'text-warning', bg: 'bg-warning/10 border-warning/30', icon: AlertTriangle };
  if (status === 'Not Ready') return { text: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', icon: XCircle };
  return { text: 'text-muted-foreground', bg: 'bg-secondary border-border/50', icon: Clock3 };
}

function findingStatusClasses(status: string) {
  switch (status) {
    case 'Pass': return 'bg-primary/10 text-primary border-primary/30';
    case 'Warning': return 'bg-warning/10 text-warning border-warning/40';
    case 'Fail': return 'bg-destructive/10 text-destructive border-destructive/40';
    case 'Not Configured': return 'bg-muted text-muted-foreground border-border/50';
    default: return 'bg-secondary text-secondary-foreground border-border/50';
  }
}

function severityClasses(severity: string) {
  switch (severity) {
    case 'Critical': return 'bg-destructive/15 text-destructive border-destructive/40';
    case 'High': return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30';
    case 'Medium': return 'bg-warning/10 text-warning border-warning/30';
    case 'Low': return 'bg-secondary text-muted-foreground border-border/50';
    default: return 'hidden';
  }
}

function providerStatusClasses(status: string): { badge: string; dot: string } {
  switch (status) {
    case 'Healthy': return { badge: 'bg-primary/10 text-primary border-primary/30', dot: 'bg-primary' };
    case 'Warning': return { badge: 'bg-warning/10 text-warning border-warning/30', dot: 'bg-warning' };
    case 'Degraded': return { badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30', dot: 'bg-orange-500' };
    case 'Auth Failed': return { badge: 'bg-destructive/10 text-destructive border-destructive/40', dot: 'bg-destructive' };
    case 'Not Configured': return { badge: 'bg-muted text-muted-foreground border-border/50', dot: 'bg-muted-foreground/40' };
    case 'No Recent Traffic': return { badge: 'bg-secondary text-muted-foreground border-border/50', dot: 'bg-muted-foreground/50' };
    default: return { badge: 'bg-secondary text-muted-foreground border-border/50', dot: 'bg-muted-foreground/40' };
  }
}

function roleBadge(role: string) {
  if (role === 'primary') return <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">Primary</span>;
  if (role === 'fallback') return <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Fallback</span>;
  return <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Standalone</span>;
}

function categoryIcon(category: string) {
  switch (category) {
    case 'tennis-data': return <RadioTower className="w-3.5 h-3.5 text-primary" />;
    case 'odds': return <Zap className="w-3.5 h-3.5 text-warning" />;
    case 'vision': return <Activity className="w-3.5 h-3.5 text-accent" />;
    case 'weather': return <Wifi className="w-3.5 h-3.5 text-primary" />;
    case 'geocoding': return <Database className="w-3.5 h-3.5 text-muted-foreground" />;
    default: return <Info className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

const SEVERITY_ORDER: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Informational: 4 };
const CATEGORIES = ['All', 'Database', 'APIs', 'Background Jobs', 'Grading', 'Walk-Forward', 'Calibration', 'Security', 'Documentation'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProviderCard({ provider, onTest }: { provider: ProviderHealthCard; onTest: (name: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { badge, dot } = providerStatusClasses(provider.status);

  return (
    <div className="rounded-xl border p-4 space-y-3 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${dot} ${provider.status === 'Healthy' ? 'animate-pulse' : ''}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{provider.name}</span>
              {roleBadge(provider.role)}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {categoryIcon(provider.category)}
              <span className="text-[11px] text-muted-foreground capitalize">{provider.category.replace('-', ' ')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={`text-xs font-mono ${badge}`}>{provider.status}</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-mono gap-1"
            onClick={() => onTest(provider.name)}
            title={`Test ${provider.name}`}
          >
            <Zap className="w-3 h-3" /> Test
          </Button>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{provider.details}</p>

      {expanded && (
        <div className="pt-2 border-t border-border/40 space-y-1.5 text-xs font-mono">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-28 shrink-0">Key configured:</span>
            <span className={provider.keyConfigured ? 'text-primary' : 'text-destructive'}>{provider.keyConfigured ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-28 shrink-0">Last successful:</span>
            <span className="text-foreground/80">{provider.lastCallAt ? new Date(provider.lastCallAt).toLocaleString() : 'No calls yet this session'}</span>
          </div>
          {provider.lastError && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-28 shrink-0">Last error:</span>
              <span className="text-destructive/80 break-all">{provider.lastError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: LaunchAuditFinding }) {
  const [expanded, setExpanded] = useState(false);
  const isActionable = finding.status !== 'Pass';

  return (
    <div
      className={`rounded-lg border p-3 space-y-1 ${isActionable ? 'border-border hover:border-primary/30' : 'border-border/40'} transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-medium text-sm">{finding.checkName}</span>
          <span className="text-xs text-muted-foreground">· {finding.category}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {finding.severity !== 'Informational' && (
            <Badge variant="outline" className={`text-[10px] font-mono ${severityClasses(finding.severity)}`}>
              {finding.severity}
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] font-mono ${findingStatusClasses(finding.status)}`}>
            {finding.status}
          </Badge>
          {isActionable && (
            <button onClick={() => setExpanded((e) => !e)} className="p-0.5 rounded hover:bg-secondary text-muted-foreground">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{finding.evidence}</p>
      {expanded && (
        <div className="pt-2 border-t border-border/30 space-y-1 text-xs">
          <div><span className="text-muted-foreground">Expected: </span><span>{finding.expectedResult}</span></div>
          <div><span className="text-muted-foreground">Actual: </span><span>{finding.actualResult}</span></div>
          <div className="mt-1.5 p-2.5 bg-secondary/50 rounded-lg border border-border/40">
            <span className="font-medium text-foreground/80">→ Action: </span>
            <span className="text-foreground/70">{finding.recommendedAction}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LaunchAuditPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [summary, setSummary] = useState<LaunchAuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [severityFilter, setSeverityFilter] = useState<string>('All');

  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');

  const loadSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/api/launch-audit/summary`, { credentials: 'include' });
      if (response.status === 401) {
        setLocation('/admin/login');
        return;
      }
      if (!response.ok) throw new Error('Unable to load launch audit');
      const data = (await response.json()) as LaunchAuditSummary;
      setSummary(data);
    } catch (error) {
      if (!silent) console.error(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [BASE_URL, setLocation]);

  useEffect(() => {
    void loadSummary();
    const timer = window.setInterval(() => void loadSummary(true), 60_000);
    return () => window.clearInterval(timer);
  }, [loadSummary]);

  const runAudit = async () => {
    setRunning(true);
    try {
      const response = await fetch(`${BASE_URL}/api/launch-audit/run`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to run launch audit');
      const data = (await response.json()) as LaunchAuditSummary;
      setSummary(data);
      toast({ title: '✅ Audit complete', description: `Overall status: ${data.overallStatus}` });
    } catch (error) {
      toast({ title: '⚠️ Audit failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const testAllProviders = async () => {
    setTestingProvider('all');
    try {
      const response = await fetch(`${BASE_URL}/api/launch-audit/providers/test`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Provider test failed');
      const data = (await response.json()) as { providers: ProviderHealthCard[] };
      setSummary((prev) => prev ? { ...prev, providers: data.providers } : prev);
      toast({ title: '✅ All providers tested' });
    } catch (error) {
      toast({ title: '⚠️ Test failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setTestingProvider(null);
    }
  };

  const testProvider = async (name: string) => {
    setTestingProvider(name);
    try {
      const encoded = encodeURIComponent(name);
      const response = await fetch(`${BASE_URL}/api/launch-audit/providers/${encoded}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Provider test failed');
      const data = (await response.json()) as { provider: ProviderHealthCard };
      setSummary((prev) =>
        prev
          ? { ...prev, providers: prev.providers.map((p) => p.name === name ? data.provider : p) }
          : prev,
      );
      toast({ title: `${name}: ${data.provider.status}` });
    } catch (error) {
      toast({ title: `⚠️ ${name} test failed`, description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setTestingProvider(null);
    }
  };

  const filteredFindings = useMemo(() => {
    if (!summary) return [];
    return summary.findings
      .filter((f) => categoryFilter === 'All' || f.category === categoryFilter)
      .filter((f) => severityFilter === 'All' || f.severity === severityFilter)
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));
  }, [summary, categoryFilter, severityFilter]);

  const statusStyle = overallStatusStyle(summary?.overallStatus);
  const StatusIcon = statusStyle.icon;

  const criticalAndHighFindings = useMemo(
    () => summary?.findings.filter((f) => (f.severity === 'Critical' || f.severity === 'High') && f.status !== 'Pass') ?? [],
    [summary],
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground mb-1">
            <ShieldCheck className="w-4 h-4" />
            Developer / Admin
          </div>
          <h1 className="text-3xl font-display font-bold">Launch Audit</h1>
          <p className="text-muted-foreground mt-1">Production readiness check + live API health monitoring.</p>
          {summary?.generatedAt && (
            <p className="text-xs text-muted-foreground/60 font-mono mt-1">
              Last snapshot: {new Date(summary.generatedAt).toLocaleString()} · auto-refreshes every 60 s
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadSummary()} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => void testAllProviders()}
            disabled={testingProvider !== null}
            className="gap-2"
          >
            <Wifi className={`w-4 h-4 ${testingProvider === 'all' ? 'animate-pulse' : ''}`} />
            Test All Providers
          </Button>
          <Button onClick={() => void runAudit()} disabled={running} className="gap-2">
            <Activity className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Running Audit…' : 'Run Full Launch Audit'}
          </Button>
        </div>
      </div>

      {/* Overall status scorecard */}
      <div className={`rounded-2xl border p-6 ${statusStyle.bg}`}>
        {loading ? (
          <div className="flex gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className={`flex items-center gap-3 text-2xl font-display font-bold ${statusStyle.text}`}>
              <StatusIcon className="w-7 h-7" />
              {summary?.overallStatus ?? 'Audit Incomplete'}
            </div>
            <div className="flex flex-wrap gap-4 md:border-l md:border-current/20 md:pl-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{summary?.passCount ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono uppercase">Pass</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-warning">{summary?.warningCount ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono uppercase">Warning</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-destructive">{summary?.failCount ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono uppercase">Fail</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-destructive">{summary?.criticalCount ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono uppercase">Critical</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500">{summary?.highCount ?? 0}</div>
                <div className="text-xs text-muted-foreground font-mono uppercase">High</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Critical / High priority banner */}
      {criticalAndHighFindings.length > 0 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center gap-2 font-bold font-mono text-sm text-destructive tracking-widest uppercase">
            <ShieldAlert className="w-5 h-5" /> {criticalAndHighFindings.length} Critical / High Finding{criticalAndHighFindings.length !== 1 ? 's' : ''} — Launch Blocked
          </div>
          {criticalAndHighFindings.map((f) => (
            <div key={`${f.category}-${f.checkName}`} className="text-sm text-foreground/80 flex gap-2">
              <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <span><strong>{f.checkName}</strong> — {f.recommendedAction}</span>
            </div>
          ))}
        </div>
      )}

      {/* Live API monitoring */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <RadioTower className="w-5 h-5 text-primary" />
              Live API Monitoring
            </div>
            <span className="text-xs font-normal text-muted-foreground font-mono">
              {summary?.providers?.length ?? 0} provider{(summary?.providers?.length ?? 0) !== 1 ? 's' : ''} configured
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : !summary?.providers?.length ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No providers loaded. Click <strong>Refresh</strong> or <strong>Test All Providers</strong>.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {summary.providers.map((provider) => (
                <ProviderCard
                  key={provider.name}
                  provider={provider}
                  onTest={(name) => void testProvider(name)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Findings table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <BadgeCheck className="w-5 h-5" /> Audit Findings
              <span className="text-base font-normal text-muted-foreground">({filteredFindings.length})</span>
            </CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              {/* Category filter */}
              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Severity filter */}
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
              >
                {['All', 'Critical', 'High', 'Medium', 'Low', 'Informational'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filteredFindings.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {summary?.findings.length
                ? 'No findings match the current filter.'
                : 'No findings yet — click "Run Full Launch Audit" to generate a complete report.'}
            </div>
          ) : (
            filteredFindings.map((finding) => (
              <FindingRow
                key={`${finding.category}-${finding.checkName}-${finding.timestamp}`}
                finding={finding}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Audit history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="w-5 h-5" /> Audit History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : summary?.history?.length ? (
            summary.history.map((entry) => (
              <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    {entry.overallStatus === 'Ready'
                      ? <CheckCircle2 className="w-4 h-4 text-primary" />
                      : entry.overallStatus === 'Not Ready'
                        ? <XCircle className="w-4 h-4 text-destructive" />
                        : <AlertTriangle className="w-4 h-4 text-warning" />}
                    <span className="font-medium text-sm">{entry.overallStatus}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">{entry.passCount} pass</Badge>
                    {entry.warningCount > 0 && <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">{entry.warningCount} warn</Badge>}
                    {entry.failCount > 0 && <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">{entry.failCount} fail</Badge>}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground font-mono">
                  {new Date(entry.completedAt).toLocaleString()}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No audit history yet — run a full audit to begin building history.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
