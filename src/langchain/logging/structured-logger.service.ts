import { Injectable, Logger } from '@nestjs/common';

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  component: string;
  event: string;
  message: string;
  userId?: string;
  requestId?: string;
  duration?: number;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface PerformanceLog {
  operation: string;
  duration: number;
  success: boolean;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class StructuredLoggerService {
  private readonly logger = new Logger(StructuredLoggerService.name);

  /**
   * Log structured entry
   */
  log(entry: Partial<LogEntry>): void {
    const structuredEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: entry.level || 'info',
      service: 'langchain-integration',
      component: entry.component || 'unknown',
      event: entry.event || 'general',
      message: entry.message || '',
      ...entry
    };

    const logMessage = this.formatLogMessage(structuredEntry);

    switch (structuredEntry.level) {
      case 'debug':
        this.logger.debug(logMessage);
        break;
      case 'info':
        this.logger.log(logMessage);
        break;
      case 'warn':
        this.logger.warn(logMessage);
        break;
      case 'error':
        this.logger.error(logMessage);
        break;
    }
  }

  /**
   * Log agent execution
   */
  logAgentExecution(
    userId: string,
    requestId: string,
    duration: number,
    success: boolean,
    intent?: string,
    toolsUsed?: string[],
    error?: Error
  ): void {
    this.log({
      level: success ? 'info' : 'error',
      component: 'agent-executor',
      event: 'agent_execution',
      message: `Agent execution ${success ? 'completed' : 'failed'}`,
      userId,
      requestId,
      duration,
      metadata: {
        success,
        intent,
        toolsUsed,
        toolCount: toolsUsed?.length || 0
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }

  /**
   * Log tool execution
   */
  logToolExecution(
    toolName: string,
    userId: string,
    requestId: string,
    duration: number,
    success: boolean,
    error?: Error
  ): void {
    this.log({
      level: success ? 'info' : 'error',
      component: 'tool-manager',
      event: 'tool_execution',
      message: `Tool ${toolName} ${success ? 'executed successfully' : 'failed'}`,
      userId,
      requestId,
      duration,
      metadata: {
        toolName,
        success
      },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }

  /**
   * Log memory operations
   */
  logMemoryOperation(
    operation: string,
    userId: string,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    this.log({
      level: success ? 'debug' : 'warn',
      component: 'memory-manager',
      event: 'memory_operation',
      message: `Memory ${operation} ${success ? 'completed' : 'failed'}`,
      userId,
      metadata: {
        operation,
        success,
        ...metadata
      }
    });
  }

  /**
   * Log intent detection
   */
  logIntentDetection(
    userId: string,
    requestId: string,
    message: string,
    detectedIntent: string,
    confidence: number,
    duration: number
  ): void {
    this.log({
      level: 'debug',
      component: 'intent-detection',
      event: 'intent_detected',
      message: `Intent detected: ${detectedIntent}`,
      userId,
      requestId,
      duration,
      metadata: {
        originalMessage: message.substring(0, 100), // Truncate for privacy
        detectedIntent,
        confidence,
        highConfidence: confidence > 0.8
      }
    });
  }

  /**
   * Log model switching
   */
  logModelSwitch(
    userId: string,
    requestId: string,
    fromModel: string,
    toModel: string,
    reason: string,
    success: boolean
  ): void {
    this.log({
      level: success ? 'warn' : 'error',
      component: 'agent-service',
      event: 'model_switch',
      message: `Model switched from ${fromModel} to ${toModel}`,
      userId,
      requestId,
      metadata: {
        fromModel,
        toModel,
        reason,
        success
      }
    });
  }

  /**
   * Log circuit breaker events
   */
  logCircuitBreakerEvent(
    circuitName: string,
    event: 'opened' | 'closed' | 'half_open' | 'execution_failed' | 'execution_succeeded',
    metadata?: Record<string, any>
  ): void {
    this.log({
      level: event === 'opened' ? 'error' : event === 'closed' ? 'info' : 'warn',
      component: 'circuit-breaker',
      event: 'circuit_breaker_event',
      message: `Circuit breaker ${circuitName} ${event}`,
      metadata: {
        circuitName,
        event,
        ...metadata
      }
    });
  }

  /**
   * Log performance metrics
   */
  logPerformance(performanceLog: PerformanceLog): void {
    this.log({
      level: 'info',
      component: 'performance',
      event: 'performance_metric',
      message: `${performanceLog.operation} took ${performanceLog.duration}ms`,
      userId: performanceLog.userId,
      requestId: performanceLog.requestId,
      duration: performanceLog.duration,
      metadata: {
        operation: performanceLog.operation,
        success: performanceLog.success,
        ...performanceLog.metadata
      }
    });
  }

  /**
   * Log security events
   */
  logSecurityEvent(
    event: string,
    userId: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: Record<string, any>
  ): void {
    this.log({
      level: severity === 'critical' || severity === 'high' ? 'error' : 'warn',
      component: 'security',
      event: 'security_event',
      message: `Security event: ${event}`,
      userId,
      metadata: {
        event,
        severity,
        ...details
      }
    });
  }

  /**
   * Log business metrics
   */
  logBusinessMetric(
    metric: string,
    value: number,
    unit: string,
    userId?: string,
    tags?: Record<string, string>
  ): void {
    this.log({
      level: 'info',
      component: 'business-metrics',
      event: 'business_metric',
      message: `${metric}: ${value} ${unit}`,
      userId,
      metadata: {
        metric,
        value,
        unit,
        tags: tags || {}
      }
    });
  }

  /**
   * Format log message for output
   */
  private formatLogMessage(entry: LogEntry): string {
    const baseInfo = `[${entry.component}] ${entry.message}`;
    
    const contextInfo = [];
    if (entry.userId) contextInfo.push(`user:${entry.userId}`);
    if (entry.requestId) contextInfo.push(`req:${entry.requestId}`);
    if (entry.duration) contextInfo.push(`${entry.duration}ms`);
    
    const context = contextInfo.length > 0 ? ` (${contextInfo.join(', ')})` : '';
    
    return `${baseInfo}${context}`;
  }

  /**
   * Create child logger for specific component
   */
  createComponentLogger(component: string): ComponentLogger {
    return new ComponentLogger(this, component);
  }
}

/**
 * Component-specific logger that automatically sets the component name
 */
export class ComponentLogger {
  constructor(
    private readonly structuredLogger: StructuredLoggerService,
    private readonly component: string
  ) {}

  debug(event: string, message: string, metadata?: Record<string, any>): void {
    this.structuredLogger.log({
      level: 'debug',
      component: this.component,
      event,
      message,
      metadata
    });
  }

  info(event: string, message: string, metadata?: Record<string, any>): void {
    this.structuredLogger.log({
      level: 'info',
      component: this.component,
      event,
      message,
      metadata
    });
  }

  warn(event: string, message: string, metadata?: Record<string, any>): void {
    this.structuredLogger.log({
      level: 'warn',
      component: this.component,
      event,
      message,
      metadata
    });
  }

  error(event: string, message: string, error?: Error, metadata?: Record<string, any>): void {
    this.structuredLogger.log({
      level: 'error',
      component: this.component,
      event,
      message,
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
}