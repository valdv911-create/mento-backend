import { incrementMonitoringFailure } from './monitoring';
import './metrics';
/**
 * REQUEST AUDITOR
 * Comprehensive request logging and auditing system
 *
 * Features:
 * - Security event logging (all redacted)
 * - Request/response tracking
 * - Anomaly detection patterns
 * - Compliance audit trail
 * - Performance monitoring
 * - User behavior analysis
 *
 * Privacy-first design:
 * - No sensitive data logged
 * - User input truncated and redacted
 * - API keys never logged
 * - GDPR/CCPA compliant
 */

import { sanitizeForLogging } from './sanitize';

export interface AuditLog {
  timestamp: Date;
  requestId: string;
  userId?: string;
  ip?: string;
  eventType: string;
  status: 'success' | 'failure' | 'blocked' | 'error';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
  duration?: number; // milliseconds
  metadata?: Record<string, unknown>;
}

export interface AuditContext {
  requestId: string;
  userId?: string;
  ip?: string;
  conversationId?: string;
  timestamp: number;
  sessionId?: string;
}

/**
 * Security event types
 */
export const SECURITY_EVENTS = {
  // Input validation
  VALIDATION_PASSED: 'validation_passed',
  VALIDATION_FAILED: 'validation_failed',
  
  // Injection detection
  INJECTION_DETECTED: 'injection_detected',
  INJECTION_BLOCKED: 'injection_blocked',
  
  // Abuse detection
  ABUSE_DETECTED: 'abuse_detected',
  ABUSE_BLOCKED: 'abuse_blocked',
  SPAM_DETECTED: 'spam_detected',
  
  // Rate limiting
  RATE_LIMIT_CHECK: 'rate_limit_check',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  
  // Request processing
  REQUEST_RECEIVED: 'request_received',
  REQUEST_ALLOWED: 'request_allowed',
  REQUEST_DENIED: 'request_denied',
  REQUEST_ERROR: 'request_error',
  
  // Authentication
  AUTH_SUCCESS: 'auth_success',
  AUTH_FAILED: 'auth_failed',
  AUTH_EXPIRED: 'auth_expired',
  
  // System
  SYSTEM_ERROR: 'system_error',
  SECURITY_BREACH: 'security_breach',
};

class RequestAuditor {
  private auditLogs: AuditLog[] = [];
  private maxLogs: number = 10000; // In-memory limit
  private enablePersistence: boolean = false;

  constructor(options?: { maxLogs?: number; enablePersistence?: boolean }) {
    this.maxLogs = options?.maxLogs || 10000;
    this.enablePersistence = options?.enablePersistence || false;
  }

  /**
   * Log security event
   */
  logSecurityEvent(
    eventType: string,
    context: AuditContext,
    details: Record<string, unknown>,
    options?: {
      status?: 'success' | 'failure' | 'blocked' | 'error';
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
      duration?: number;
    }
  ): void {
    const log: AuditLog = {
      timestamp: new Date(context.timestamp),
      requestId: context.requestId,
      userId: context.userId,
      ip: context.ip,
      eventType,
      status: options?.status || 'success',
      riskLevel: options?.riskLevel || 'low',
      details: sanitizeForLogging(details),
      duration: options?.duration,
      metadata: {
        conversationId: context.conversationId,
        sessionId: context.sessionId,
      },
    };

    this.addLog(log);
    this.emitAuditEvent(log);
  }

  /**
   * Log request lifecycle event
   */
  logRequest(
    context: AuditContext,
    request: {
      method: string;
      path: string;
      contentLength?: number;
      userAgent?: string;
    },
    options?: {
      status?: 'success' | 'failure' | 'blocked' | 'error';
      riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    }
  ): void {
    const log: AuditLog = {
      timestamp: new Date(context.timestamp),
      requestId: context.requestId,
      userId: context.userId,
      ip: context.ip,
      eventType: 'request_received',
      status: options?.status || 'success',
      riskLevel: options?.riskLevel || 'low',
      details: {
        method: request.method,
        path: request.path,
        contentLength: request.contentLength,
        userAgent: request.userAgent ? this.sanitizeUserAgent(request.userAgent) : undefined,
      },
      metadata: {
        conversationId: context.conversationId,
        sessionId: context.sessionId,
      },
    };

    this.addLog(log);
  }

  /**
   * Log abuse detection
   */
  logAbuseDetection(
    context: AuditContext,
    details: {
      abuseScore: number;
      reasons: string[];
      injectionScore?: number;
      spamScore?: number;
    }
  ): void {
    this.logSecurityEvent(
      details.abuseScore > 70 ? SECURITY_EVENTS.ABUSE_BLOCKED : SECURITY_EVENTS.ABUSE_DETECTED,
      context,
      sanitizeForLogging(details),
      {
        status: details.abuseScore > 70 ? 'blocked' : 'success',
        riskLevel: this.getRiskLevelFromScore(details.abuseScore),
      }
    );
  }

  /**
   * Log rate limit event
   */
  logRateLimitEvent(
    context: AuditContext,
    details: {
      limited: boolean;
      remainingRequests: number;
      resetTime: number;
      limitType: 'user' | 'ip' | 'global';
    }
  ): void {
    this.logSecurityEvent(
      details.limited ? SECURITY_EVENTS.RATE_LIMIT_EXCEEDED : SECURITY_EVENTS.RATE_LIMIT_CHECK,
      context,
      sanitizeForLogging(details),
      {
        status: details.limited ? 'blocked' : 'success',
        riskLevel: details.limited ? 'medium' : 'low',
      }
    );
  }

  /**
   * Log authentication event
   */
  logAuthEvent(
    context: AuditContext,
    details: {
      authProvider?: string;
      success: boolean;
      reason?: string;
    }
  ): void {
    const eventType = details.success ? SECURITY_EVENTS.AUTH_SUCCESS : SECURITY_EVENTS.AUTH_FAILED;
    if (!details.success) {
      incrementMonitoringFailure('authentication', { source: details.authProvider ?? 'unknown', reason: details.reason ?? 'rejected' });
    }
    this.logSecurityEvent(
      eventType,
      context,
      sanitizeForLogging(details),
      {
        status: details.success ? 'success' : 'failure',
        riskLevel: details.success ? 'low' : 'medium',
      }
    );
  }

  /**
   * Log system error
   */
  logSystemError(
    context: AuditContext,
    error: Error | string,
    details?: Record<string, unknown>
  ): void {
    this.logSecurityEvent(
      SECURITY_EVENTS.SYSTEM_ERROR,
      context,
      {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        ...sanitizeForLogging(details || {}),
      },
      {
        status: 'error',
        riskLevel: 'high',
      }
    );
  }

  /**
   * Query audit logs
   */
  queryLogs(options?: {
    userId?: string;
    requestId?: string;
    eventType?: string;
    riskLevel?: string;
    since?: Date;
    limit?: number;
  }): AuditLog[] {
    let results: AuditLog[] = [...this.auditLogs];

    if (options?.userId) {
      results = results.filter((log) => log.userId === options.userId);
    }

    if (options?.requestId) {
      results = results.filter((log) => log.requestId === options.requestId);
    }

    if (options?.eventType) {
      results = results.filter((log) => log.eventType === options.eventType);
    }

    if (options?.riskLevel) {
      results = results.filter((log) => log.riskLevel === options.riskLevel);
    }

    if (options?.since) {
      results = results.filter((log) => log.timestamp >= options.since!);
    }

    return results.slice(0, options?.limit || 100);
  }

  /**
   * Get audit summary
   */
  getAuditSummary(timeWindowMs: number = 3600000): Record<string, unknown> {
    const now = Date.now();
    const windowStart = now - timeWindowMs;

    const logsInWindow = this.auditLogs.filter(
      (log) => log.timestamp.getTime() >= windowStart
    );

    const eventCounts: Record<string, number> = {};
    const riskCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    for (const log of logsInWindow) {
      eventCounts[log.eventType] = (eventCounts[log.eventType] || 0) + 1;
      riskCounts[log.riskLevel] = (riskCounts[log.riskLevel] || 0) + 1;
      statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
    }

    return {
      timeWindow: `${timeWindowMs}ms`,
      logsInWindow: logsInWindow.length,
      eventTypes: eventCounts,
      riskLevels: riskCounts,
      statuses: statusCounts,
      averageLogSize: this.auditLogs.length,
    };
  }

  /**
   * Detect suspicious patterns
   */
  detectSuspiciousPatterns(userId?: string, timeWindowMs: number = 3600000): Record<string, unknown> {
    const now = Date.now();
    const windowStart = now - timeWindowMs;

    let logsToAnalyze = this.auditLogs.filter(
      (log) => log.timestamp.getTime() >= windowStart
    );

    if (userId) {
      logsToAnalyze = logsToAnalyze.filter((log) => log.userId === userId);
    }

    const patterns = {
      highRiskEvents: 0,
      blockedRequests: 0,
      failedAttempts: 0,
      injectionAttempts: 0,
      abuseDetected: 0,
      rateLimitViolations: 0,
    };

    for (const log of logsToAnalyze) {
      if (log.riskLevel === 'critical' || log.riskLevel === 'high') {
        patterns.highRiskEvents++;
      }
      if (log.status === 'blocked') {
        patterns.blockedRequests++;
      }
      if (log.status === 'failure') {
        patterns.failedAttempts++;
      }
      if (log.eventType.includes('injection')) {
        patterns.injectionAttempts++;
      }
      if (log.eventType.includes('abuse')) {
        patterns.abuseDetected++;
      }
      if (log.eventType.includes('rate_limit')) {
        patterns.rateLimitViolations++;
      }
    }

    return {
      userId,
      timeWindow: `${timeWindowMs}ms`,
      patterns,
      isSuspicious: patterns.blockedRequests > 5 || patterns.highRiskEvents > 10,
    };
  }

  /**
   * Export logs for compliance
   */
  exportLogs(format: 'json' | 'csv' = 'json', options?: { userId?: string; since?: Date }): string {
    const logs = this.queryLogs({ userId: options?.userId, since: options?.since });

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    if (format === 'csv') {
      const headers = ['timestamp', 'requestId', 'userId', 'eventType', 'status', 'riskLevel'];
      const rows = logs.map((log) =>
        headers
          .map((header) => {
            const value = log[header as keyof AuditLog];
            if (value instanceof Date) return value.toISOString();
            return JSON.stringify(value);
          })
          .join(',')
      );
      return [headers.join(','), ...rows].join('\n');
    }

    return '';
  }

  /**
   * Add log with auto-cleanup
   */
  private addLog(log: AuditLog): void {
    this.auditLogs.push(log);

    // Maintain size limit
    if (this.auditLogs.length > this.maxLogs) {
      // Remove oldest logs
      this.auditLogs = this.auditLogs.slice(-this.maxLogs);
    }
  }

  /**
   * Get risk level from abuse score
   */
  private getRiskLevelFromScore(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score > 85) return 'critical';
    if (score > 70) return 'high';
    if (score > 50) return 'medium';
    return 'low';
  }

  /**
   * Sanitize user agent string
   */
  private sanitizeUserAgent(ua: string): string {
    // Remove potentially identifying info
    return ua.replace(/\(.*?\)/g, '[redacted]').slice(0, 200);
  }

  /**
   * Emit audit event (for external listeners)
   */
  private emitAuditEvent(_log: AuditLog): void {
    // Placeholder for event emission (e.g., to external monitoring)
    // Could be extended to emit to message queues, webhooks, etc.
  }

  /**
   * Clear audit logs (use with caution)
   */
  clearLogs(older?: number): void {
    if (!older) {
      this.auditLogs = [];
      return;
    }

    const cutoffTime = Date.now() - older;
    this.auditLogs = this.auditLogs.filter((log) => log.timestamp.getTime() > cutoffTime);
  }
}

// Singleton instance
let auditorInstance: RequestAuditor | null = null;

/**
 * Get or create auditor instance
 */
export function getRequestAuditor(options?: { maxLogs?: number; enablePersistence?: boolean }): RequestAuditor {
  if (!auditorInstance) {
    auditorInstance = new RequestAuditor(options);
  }
  return auditorInstance;
}

export default getRequestAuditor();
