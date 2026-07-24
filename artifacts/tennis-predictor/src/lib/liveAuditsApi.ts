import { z } from 'zod';

export type LiveAuditsRole = 'owner' | 'admin' | 'developer' | 'user' | 'unknown';

export type LiveAuditsStatus = 'Healthy' | 'Warning' | 'Critical' | 'Running' | 'Unknown';

export interface LiveAuditsPermissions {
  canRunAudits: boolean;
  canViewLogs: boolean;
  canRetrySafeJobs: boolean;
  canManageAlerts: boolean;
  canRunPerformanceTests: boolean;
  canRunDestructiveRollback: boolean;
  canRunDestructiveRepairs: boolean;
}

export interface LiveAuditsAccess {
  authenticated: boolean;
  role: LiveAuditsRole;
  canAccessLiveAudits: boolean;
  permissions: LiveAuditsPermissions;
}

const DefaultPermissions: Record<LiveAuditsRole, LiveAuditsPermissions> = {
  owner: {
    canRunAudits: true,
    canViewLogs: true,
    canRetrySafeJobs: true,
    canManageAlerts: true,
    canRunPerformanceTests: true,
    canRunDestructiveRollback: true,
    canRunDestructiveRepairs: true,
  },
  admin: {
    canRunAudits: true,
    canViewLogs: true,
    canRetrySafeJobs: true,
    canManageAlerts: true,
    canRunPerformanceTests: true,
    canRunDestructiveRollback: false,
    canRunDestructiveRepairs: false,
  },
  developer: {
    canRunAudits: true,
    canViewLogs: true,
    canRetrySafeJobs: true,
    canManageAlerts: false,
    canRunPerformanceTests: false,
    canRunDestructiveRollback: false,
    canRunDestructiveRepairs: false,
  },
  user: {
    canRunAudits: false,
    canViewLogs: false,
    canRetrySafeJobs: false,
    canManageAlerts: false,
    canRunPerformanceTests: false,
    canRunDestructiveRollback: false,
    canRunDestructiveRepairs: false,
  },
  unknown: {
    canRunAudits: false,
    canViewLogs: false,
    canRetrySafeJobs: false,
    canManageAlerts: false,
    canRunPerformanceTests: false,
    canRunDestructiveRollback: false,
    canRunDestructiveRepairs: false,
  },
};

const AuthPayload = z
  .object({
    authenticated: z.boolean(),
    role: z.string().optional(),
    permissions: z
      .object({
        canRunAudits: z.boolean().optional(),
        canViewLogs: z.boolean().optional(),
        canRetrySafeJobs: z.boolean().optional(),
        canManageAlerts: z.boolean().optional(),
        canRunPerformanceTests: z.boolean().optional(),
        canRunDestructiveRollback: z.boolean().optional(),
        canRunDestructiveRepairs: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

function normalizeRole(input: string | undefined, authenticated: boolean): LiveAuditsRole {
  if (!authenticated) return 'user';
  if (!input) return 'owner';

  const normalized = input.trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'developer' || normalized === 'dev') return 'developer';
  if (normalized === 'user') return 'user';
  return 'unknown';
}

function mergePermissions(role: LiveAuditsRole, partial: Partial<LiveAuditsPermissions> | undefined): LiveAuditsPermissions {
  return {
    ...DefaultPermissions[role],
    ...partial,
  };
}

export async function getLiveAuditsAccess(): Promise<LiveAuditsAccess> {
  const response = await fetch('/api/auth/status', {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch auth status');
  }

  const parsed = AuthPayload.safeParse(await response.json());
  if (!parsed.success) {
    return {
      authenticated: false,
      role: 'unknown',
      canAccessLiveAudits: false,
      permissions: DefaultPermissions.unknown,
    };
  }

  const role = normalizeRole(parsed.data.role, parsed.data.authenticated);
  const permissions = mergePermissions(role, parsed.data.permissions);

  return {
    authenticated: parsed.data.authenticated,
    role,
    canAccessLiveAudits: role === 'owner' || role === 'admin' || role === 'developer',
    permissions,
  };
}

export interface LiveAuditsRequestResult<T> {
  status: 'success' | 'not-configured' | 'unauthorized' | 'forbidden' | 'error' | 'timeout';
  data?: T;
  endpoint?: string;
  message?: string;
}

export interface LaunchAuditFinding {
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
  responseTimeMs?: number;
  failureReason?: string;
}

export interface LaunchAuditHistoryEntry {
  id: string;
  completedAt: string;
  overallStatus: string;
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  reportPath: string;
  auditId?: string;
  version?: string;
  commit?: string;
}

export interface LaunchAuditSummary {
  overallStatus: string;
  passCount: number;
  warningCount: number;
  failCount: number;
  criticalCount: number;
  highCount: number;
  findings: LaunchAuditFinding[];
  history?: LaunchAuditHistoryEntry[];
  auditId?: string;
  startedAt?: string;
  completedAt?: string;
  commit?: string;
  version?: string;
  status?: string;
  errors?: string[];
  warnings?: string[];
}

const LaunchAuditSummarySchema = z
  .object({
    overallStatus: z.string(),
    passCount: z.number().default(0),
    warningCount: z.number().default(0),
    failCount: z.number().default(0),
    criticalCount: z.number().default(0),
    highCount: z.number().default(0),
    findings: z
      .array(
        z
          .object({
            category: z.string().default('Unknown'),
            checkName: z.string().default('Unknown check'),
            status: z.string().default('Unknown'),
            severity: z.string().default('Unknown'),
            evidence: z.string().default('No evidence provided'),
            expectedResult: z.string().default('N/A'),
            actualResult: z.string().default('N/A'),
            recommendedAction: z.string().default('Review service logs'),
            relatedService: z.string().default('unknown-service'),
            timestamp: z.string().default(new Date(0).toISOString()),
            responseTimeMs: z.number().optional(),
            failureReason: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
    history: z
      .array(
        z
          .object({
            id: z.string(),
            completedAt: z.string(),
            overallStatus: z.string(),
            passCount: z.number().default(0),
            warningCount: z.number().default(0),
            failCount: z.number().default(0),
            criticalCount: z.number().default(0),
            highCount: z.number().default(0),
            reportPath: z.string().default(''),
            auditId: z.string().optional(),
            version: z.string().optional(),
            commit: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    auditId: z.string().optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    commit: z.string().optional(),
    version: z.string().optional(),
    status: z.string().optional(),
    errors: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

const REQUEST_TIMEOUT_MS = 18_000;

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error.length) return data.error;
  } catch {
    // no-op; response body was not JSON
  }
  return response.statusText || 'Request failed';
}

function withTimeoutSignal(parentSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  controller.signal.addEventListener(
    'abort',
    () => {
      window.clearTimeout(timeout);
    },
    { once: true },
  );

  return controller.signal;
}

export async function requestFirstAvailable<T>(
  endpoints: string[],
  init: RequestInit,
  parser?: (value: unknown) => T,
): Promise<LiveAuditsRequestResult<T>> {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        ...init,
        credentials: 'include',
        signal: withTimeoutSignal(init.signal),
      });

      if (response.status === 404) {
        continue;
      }

      if (response.status === 401) {
        return { status: 'unauthorized', endpoint, message: await readErrorMessage(response) };
      }

      if (response.status === 403) {
        return { status: 'forbidden', endpoint, message: await readErrorMessage(response) };
      }

      if (!response.ok) {
        return { status: 'error', endpoint, message: await readErrorMessage(response) };
      }

      const raw = (await response.json()) as unknown;
      const data = parser ? parser(raw) : (raw as T);
      return { status: 'success', data, endpoint };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'timeout', endpoint, message: 'Request timed out' };
      }
      return {
        status: 'error',
        endpoint,
        message: error instanceof Error ? error.message : 'Unknown request error',
      };
    }
  }

  return {
    status: 'not-configured',
    message: 'Endpoint is not configured in this environment',
  };
}

export function mapLaunchSummary(raw: unknown): LaunchAuditSummary {
  const parsed = LaunchAuditSummarySchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    overallStatus: 'Audit Incomplete',
    passCount: 0,
    warningCount: 0,
    failCount: 0,
    criticalCount: 0,
    highCount: 0,
    findings: [],
  };
}

export async function getLiveAuditsOverview(signal?: AbortSignal) {
  return requestFirstAvailable<LaunchAuditSummary>(
    ['/api/live-audits/overview', '/api/launch-audit/summary'],
    { method: 'GET', signal },
    mapLaunchSummary,
  );
}

export async function runFullLaunchAudit(signal?: AbortSignal) {
  return requestFirstAvailable<LaunchAuditSummary>(
    ['/api/live-audits/deployment/full-launch/run', '/api/launch-audit/run'],
    { method: 'POST', signal },
    mapLaunchSummary,
  );
}

export async function getLiveAuditsSection<T = Record<string, unknown>>(section: string, signal?: AbortSignal) {
  return requestFirstAvailable<T>(
    [`/api/live-audits/${section}`],
    { method: 'GET', signal },
  );
}

export async function postLiveAuditsAction<T = Record<string, unknown>>(
  actionPath: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return requestFirstAvailable<T>(
    [`/api/live-audits/${actionPath}`],
    {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    },
  );
}

export function normalizeStatus(status: string | undefined): LiveAuditsStatus {
  if (!status) return 'Unknown';
  const normalized = status.trim().toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('ready') || normalized === 'pass') return 'Healthy';
  if (normalized.includes('warn')) return 'Warning';
  if (normalized.includes('critical') || normalized.includes('fail') || normalized.includes('error') || normalized.includes('not ready')) return 'Critical';
  if (normalized.includes('running') || normalized.includes('queued') || normalized.includes('in progress')) return 'Running';
  return 'Unknown';
}
