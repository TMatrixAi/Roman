import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getOddsProviderStatuses } from './oddsData';
import { getTennisDataProvider } from './tennisData';
import { getAdminAccessKey } from '../lib/adminAuth';

export interface LaunchAuditFinding {
  category: string;
  checkName: string;
  status: 'Pass' | 'Warning' | 'Fail' | 'Not Configured' | 'Not Applicable' | 'Unable to Verify';
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
  evidence: string;
  expectedResult: string;
  actualResult: string;
  recommendedAction: string;
  relatedService: string;
  timestamp: string;
}

export interface LaunchAuditSummary {
  overallStatus: 'Ready' | 'Ready With Warnings' | 'Not Ready' | 'Audit Incomplete';
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  findings: LaunchAuditFinding[];
  reportPath?: string;
  history?: LaunchAuditHistoryEntry[];
}

export interface LaunchAuditHistoryEntry {
  id: string;
  startedAt: string;
  completedAt: string;
  overallStatus: LaunchAuditSummary['overallStatus'];
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  reportPath: string;
}

export function deriveOverallStatus(findings: LaunchAuditFinding[]): LaunchAuditSummary['overallStatus'] {
  if (findings.length === 0) return 'Audit Incomplete';

  const hasCritical = findings.some((finding) => finding.severity === 'Critical');
  if (hasCritical) return 'Not Ready';

  const hasHigh = findings.some((finding) => finding.severity === 'High');
  if (hasHigh) return 'Not Ready';

  const hasFail = findings.some((finding) => finding.status === 'Fail');
  const hasWarning = findings.some((finding) => finding.status === 'Warning');

  if (hasFail || hasWarning) return 'Ready With Warnings';
  return 'Ready';
}

export function buildLaunchAuditSummary(findings: LaunchAuditFinding[]): LaunchAuditSummary {
  const passCount = findings.filter((finding) => finding.status === 'Pass').length;
  const warningCount = findings.filter((finding) => finding.status === 'Warning').length;
  const failCount = findings.filter((finding) => finding.status === 'Fail').length;
  const criticalCount = findings.filter((finding) => finding.severity === 'Critical').length;
  const highCount = findings.filter((finding) => finding.severity === 'High').length;

  return {
    overallStatus: deriveOverallStatus(findings),
    passCount,
    warningCount,
    failCount,
    criticalCount,
    highCount,
    findings,
  };
}

function resolveLaunchAuditDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'docs', 'launch-audit'),
    path.resolve(process.cwd(), '..', '..', 'docs', 'launch-audit'),
    path.resolve(process.cwd(), '..', 'docs', 'launch-audit'),
  ];

  for (const candidate of candidates) {
    if (candidate.includes('Tennis-Stats-Engine')) return candidate;
  }

  return candidates[0];
}

async function ensureLaunchAuditDir(): Promise<string> {
  const dir = resolveLaunchAuditDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function buildMarkdownReport(summary: LaunchAuditSummary, reportPath: string): string {
  const lines = [
    '# Launch Audit Report',
    '',
    `- Report generated: ${new Date().toISOString()}`,
    `- Overall status: ${summary.overallStatus}`,
    `- Pass count: ${summary.passCount}`,
    `- Warning count: ${summary.warningCount}`,
    `- Fail count: ${summary.failCount}`,
    '',
    '## Findings',
    '',
  ];

  for (const finding of summary.findings) {
    lines.push(`- ${finding.category} / ${finding.checkName} — ${finding.status} (${finding.severity})`);
    lines.push(`  - Evidence: ${finding.evidence}`);
    lines.push(`  - Recommendation: ${finding.recommendedAction}`);
  }

  lines.push('', `Report path: ${reportPath}`);
  return `${lines.join('\n')}\n`;
}

async function readHistory(): Promise<LaunchAuditHistoryEntry[]> {
  const dir = await ensureLaunchAuditDir();
  const historyPath = path.join(dir, 'history.json');
  try {
    const raw = await fs.readFile(historyPath, 'utf8');
    const parsed = JSON.parse(raw) as LaunchAuditHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(history: LaunchAuditHistoryEntry[]): Promise<void> {
  const dir = await ensureLaunchAuditDir();
  const historyPath = path.join(dir, 'history.json');
  await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

export async function runLaunchAudit(): Promise<LaunchAuditSummary> {
  const provider = getTennisDataProvider();
  const providerStatus = provider.getStatus();
  const adminAccessKey = getAdminAccessKey();
  const oddsStatuses = getOddsProviderStatuses();

  const findings: LaunchAuditFinding[] = [
    {
      category: 'APIs',
      checkName: 'Primary tennis data provider',
      status: providerStatus.connected ? 'Pass' : 'Fail',
      severity: providerStatus.connected ? 'Informational' : 'Critical',
      evidence: providerStatus.lastError ?? 'Provider responded successfully',
      expectedResult: 'Provider available',
      actualResult: providerStatus.connected ? 'Connected' : 'Disconnected',
      recommendedAction: providerStatus.connected ? 'Keep monitoring' : 'Restore provider access',
      relatedService: providerStatus.provider,
      timestamp: new Date().toISOString(),
    },
    {
      category: 'APIs',
      checkName: 'Odds providers',
      status: oddsStatuses.length > 0 ? 'Pass' : 'Warning',
      severity: oddsStatuses.length > 0 ? 'Informational' : 'Medium',
      evidence: oddsStatuses.length > 0 ? `${oddsStatuses.length} odds provider(s) configured` : 'No odds providers configured',
      expectedResult: 'Odds providers available when enabled',
      actualResult: oddsStatuses.length > 0 ? 'Configured' : 'Not configured',
      recommendedAction: oddsStatuses.length > 0 ? 'Keep monitoring' : 'Add odds provider configuration if needed',
      relatedService: 'odds-data',
      timestamp: new Date().toISOString(),
    },
    {
      category: 'Security',
      checkName: 'Admin access key',
      status: adminAccessKey ? 'Pass' : 'Warning',
      severity: adminAccessKey ? 'Informational' : 'Medium',
      evidence: adminAccessKey ? 'Admin access key configured' : 'Admin access key not configured',
      expectedResult: 'Admin access key configured',
      actualResult: adminAccessKey ? 'Configured' : 'Missing',
      recommendedAction: adminAccessKey ? 'Keep monitoring' : 'Set ADMIN_ACCESS_KEY before enabling admin workflows',
      relatedService: 'admin-auth',
      timestamp: new Date().toISOString(),
    },
  ];

  const summary = buildLaunchAuditSummary(findings);
  const dir = await ensureLaunchAuditDir();
  const reportPath = path.join(dir, `launch-audit-${Date.now()}.md`);
  const reportContents = buildMarkdownReport(summary, reportPath);
  await fs.writeFile(reportPath, reportContents, 'utf8');
  await fs.writeFile(path.join(dir, 'latest-launch-audit.md'), reportContents, 'utf8');

  const history = await readHistory();
  history.unshift({
    id: `audit-${Date.now()}`,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    overallStatus: summary.overallStatus,
    passCount: summary.passCount,
    warningCount: summary.warningCount,
    failCount: summary.failCount,
    criticalCount: summary.criticalCount,
    highCount: summary.highCount,
    reportPath,
  });
  await writeHistory(history.slice(0, 10));

  summary.reportPath = reportPath;
  summary.history = history.slice(0, 10);
  return summary;
}

export async function getLaunchAuditSummary(): Promise<LaunchAuditSummary> {
  const provider = getTennisDataProvider();
  const providerStatus = provider.getStatus();
  const oddsStatuses = getOddsProviderStatuses();

  const findings: LaunchAuditFinding[] = [
    {
      category: 'APIs',
      checkName: 'Primary tennis data provider',
      status: providerStatus.connected ? 'Pass' : 'Fail',
      severity: providerStatus.connected ? 'Informational' : 'Critical',
      evidence: providerStatus.lastError ?? 'Provider responded successfully',
      expectedResult: 'Provider available',
      actualResult: providerStatus.connected ? 'Connected' : 'Disconnected',
      recommendedAction: providerStatus.connected ? 'Keep monitoring' : 'Restore provider access',
      relatedService: providerStatus.provider,
      timestamp: new Date().toISOString(),
    },
    {
      category: 'APIs',
      checkName: 'Odds providers',
      status: oddsStatuses.length > 0 ? 'Pass' : 'Warning',
      severity: oddsStatuses.length > 0 ? 'Informational' : 'Medium',
      evidence: oddsStatuses.length > 0 ? `${oddsStatuses.length} odds provider(s) configured` : 'No odds providers configured',
      expectedResult: 'Odds providers available when enabled',
      actualResult: oddsStatuses.length > 0 ? 'Configured' : 'Not configured',
      recommendedAction: oddsStatuses.length > 0 ? 'Keep monitoring' : 'Add odds provider configuration if needed',
      relatedService: 'odds-data',
      timestamp: new Date().toISOString(),
    },
  ];

  const summary = buildLaunchAuditSummary(findings);
  const history = await readHistory();
  summary.history = history;
  return summary;
}
