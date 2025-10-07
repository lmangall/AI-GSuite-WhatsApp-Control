import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LangChainConfigService } from '../config/langchain-config.service';
import { LangChainAgentService } from '../agent/langchain-agent.service';
import { LangChainToolManagerService } from '../tools/tool-manager.service';
import { LangChainMemoryManagerService } from '../memory/memory-manager.service';
import { LangChainAgentExecutorService } from '../executor/agent-executor.service';

export interface LangChainHealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    configuration: ComponentHealth;
    models: ComponentHealth;
    tools: ComponentHealth;
    memory: ComponentHealth;
    executor: ComponentHealth;
  };
  metrics: LangChainMetrics;
  timestamp: Date;
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  details?: Record<string, any>;
}

export interface LangChainMetrics {
  totalExecutions: number;
  successRate: number;
  averageResponseTime: number;
  toolUsageStats: Record<string, number>;
  memoryStats: {
    totalUsers: number;
    totalMessages: number;
  };
  errorRate: number;
  lastExecutionTime?: Date;
}

@Injectable()
export class LangChainMonitoringService implements OnModuleInit {
  private readonly logger = new Logger(LangChainMonitoringService.name);
  private healthCheckInterval?: NodeJS.Timeout;
  private lastHealthCheck?: LangChainHealthStatus;

  constructor(
    private readonly configService: LangChainConfigService,
    private readonly agentService: LangChainAgentService,
    private readonly toolManager: LangChainToolManagerService,
    private readonly memoryManager: LangChainMemoryManagerService,
    private readonly agentExecutor: LangChainAgentExecutorService
  ) {}

  async onModuleInit(): Promise<void> {
    // Perform initial configuration validation
    await this.validateConfiguration();
    
    // Start periodic health checks
    this.startHealthCheckInterval();
    
    this.logger.log('LangChain monitoring service initialized');
  }

  /**
   * Validate LangChain configuration on startup
   */
  async validateConfiguration(): Promise<void> {
    try {
      this.logger.log('🔍 Validating LangChain configuration...');

      const validation = this.configService.validateConfiguration();
      
      if (!validation.isValid) {
        const errorMessage = `Configuration validation failed: ${validation.errors.join(', ')}`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      // Additional runtime validations
      await this.validateRuntimeConfiguration();

      this.logger.log('✅ LangChain configuration validation passed');
    } catch (error) {
      this.logger.error('❌ LangChain configuration validation failed:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<LangChainHealthStatus> {
    const startTime = Date.now();
    
    try {
      const [configHealth, modelsHealth, toolsHealth, memoryHealth, executorHealth] = await Promise.all([
        this.checkConfigurationHealth(),
        this.checkModelsHealth(),
        this.checkToolsHealth(),
        this.checkMemoryHealth(),
        this.checkExecutorHealth()
      ]);

      const components = {
        configuration: configHealth,
        models: modelsHealth,
        tools: toolsHealth,
        memory: memoryHealth,
        executor: executorHealth
      };

      // Determine overall health
      const componentStatuses = Object.values(components).map(c => c.status);
      let overall: 'healthy' | 'degraded' | 'unhealthy';
      
      if (componentStatuses.every(s => s === 'healthy')) {
        overall = 'healthy';
      } else if (componentStatuses.some(s => s === 'unhealthy')) {
        overall = 'unhealthy';
      } else {
        overall = 'degraded';
      }

      const metrics = await this.collectMetrics();

      const healthStatus: LangChainHealthStatus = {
        overall,
        components,
        metrics,
        timestamp: new Date()
      };

      this.lastHealthCheck = healthStatus;
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Health check completed in ${duration}ms - Status: ${overall}`);
      
      return healthStatus;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      
      return {
        overall: 'unhealthy',
        components: {
          configuration: { status: 'unhealthy', message: 'Health check failed' },
          models: { status: 'unhealthy', message: 'Health check failed' },
          tools: { status: 'unhealthy', message: 'Health check failed' },
          memory: { status: 'unhealthy', message: 'Health check failed' },
          executor: { status: 'unhealthy', message: 'Health check failed' }
        },
        metrics: {
          totalExecutions: 0,
          successRate: 0,
          averageResponseTime: 0,
          toolUsageStats: {},
          memoryStats: { totalUsers: 0, totalMessages: 0 },
          errorRate: 100
        },
        timestamp: new Date()
      };
    }
  }

  /**
   * Get cached health status (faster)
   */
  getCachedHealthStatus(): LangChainHealthStatus | null {
    return this.lastHealthCheck || null;
  }

  /**
   * Collect performance metrics
   */
  async collectMetrics(): Promise<LangChainMetrics> {
    try {
      const executorStats = this.agentExecutor.getExecutionStats();
      const toolStats = this.toolManager.getToolStats();
      const memoryStats = this.memoryManager.getMemoryStats();

      return {
        totalExecutions: executorStats.totalExecutions,
        successRate: executorStats.totalExecutions > 0 
          ? (executorStats.successfulExecutions / executorStats.totalExecutions) * 100 
          : 0,
        averageResponseTime: executorStats.averageExecutionTime,
        toolUsageStats: executorStats.mostUsedTools.reduce((acc, tool) => {
          acc[tool.toolName] = tool.count;
          return acc;
        }, {} as Record<string, number>),
        memoryStats: {
          totalUsers: memoryStats.totalUsers,
          totalMessages: memoryStats.totalMessages
        },
        errorRate: executorStats.errorRate,
        lastExecutionTime: executorStats.totalExecutions > 0 ? new Date() : undefined
      };
    } catch (error) {
      this.logger.error('Failed to collect metrics:', error);
      return {
        totalExecutions: 0,
        successRate: 0,
        averageResponseTime: 0,
        toolUsageStats: {},
        memoryStats: { totalUsers: 0, totalMessages: 0 },
        errorRate: 0
      };
    }
  }

  /**
   * Check configuration health
   */
  private async checkConfigurationHealth(): Promise<ComponentHealth> {
    try {
      const validation = this.configService.validateConfiguration();
      
      if (validation.isValid) {
        return {
          status: 'healthy',
          message: 'Configuration is valid',
          details: { validationPassed: true }
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Configuration validation failed: ${validation.errors.join(', ')}`,
          details: { errors: validation.errors }
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Configuration check failed: ${error.message}`
      };
    }
  }

  /**
   * Check models health
   */
  private async checkModelsHealth(): Promise<ComponentHealth> {
    try {
      const modelHealth = await this.agentService.getModelHealthStatus();
      
      if (modelHealth.primary.available && modelHealth.fallback.available) {
        return {
          status: 'healthy',
          message: 'Both primary and fallback models are available',
          details: modelHealth
        };
      } else if (modelHealth.primary.available || modelHealth.fallback.available) {
        return {
          status: 'degraded',
          message: 'Only one model is available',
          details: modelHealth
        };
      } else {
        return {
          status: 'unhealthy',
          message: 'No models are available',
          details: modelHealth
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Model health check failed: ${error.message}`
      };
    }
  }

  /**
   * Check tools health
   */
  private async checkToolsHealth(): Promise<ComponentHealth> {
    try {
      const toolStats = this.toolManager.getToolStats();
      
      if (toolStats.totalTools > 0) {
        return {
          status: 'healthy',
          message: `${toolStats.totalTools} tools available`,
          details: toolStats
        };
      } else {
        return {
          status: 'degraded',
          message: 'No tools available',
          details: toolStats
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Tool health check failed: ${error.message}`
      };
    }
  }

  /**
   * Check memory health
   */
  private async checkMemoryHealth(): Promise<ComponentHealth> {
    try {
      const memoryStats = this.memoryManager.getMemoryStats();
      
      return {
        status: 'healthy',
        message: `Memory system operational`,
        details: memoryStats
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Memory health check failed: ${error.message}`
      };
    }
  }

  /**
   * Check executor health
   */
  private async checkExecutorHealth(): Promise<ComponentHealth> {
    try {
      const executorStats = this.agentExecutor.getExecutionStats();
      
      if (executorStats.errorRate < 50) {
        return {
          status: 'healthy',
          message: `Executor operational (${executorStats.errorRate.toFixed(1)}% error rate)`,
          details: executorStats
        };
      } else if (executorStats.errorRate < 80) {
        return {
          status: 'degraded',
          message: `High error rate (${executorStats.errorRate.toFixed(1)}%)`,
          details: executorStats
        };
      } else {
        return {
          status: 'unhealthy',
          message: `Very high error rate (${executorStats.errorRate.toFixed(1)}%)`,
          details: executorStats
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Executor health check failed: ${error.message}`
      };
    }
  }

  /**
   * Validate runtime configuration
   */
  private async validateRuntimeConfiguration(): Promise<void> {
    const config = this.configService.getLangChainConfig();
    
    // Check API keys
    if (config.defaultModel === 'gemini' && !this.configService.getGeminiApiKey()) {
      throw new Error('Gemini API key is required but not configured');
    }
    
    if (config.fallbackModel === 'openai' && !this.configService.getOpenAIApiKey()) {
      throw new Error('OpenAI API key is required but not configured');
    }

    // Check tool configuration
    if (config.enabledTools.includes('brave_search') && !this.configService.getBraveApiKey()) {
      this.logger.warn('Brave Search is enabled but API key is not configured');
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheckInterval(): void {
    const intervalMinutes = 5; // Health check every 5 minutes
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.getHealthStatus();
      } catch (error) {
        this.logger.error('Periodic health check failed:', error);
      }
    }, intervalMinutes * 60 * 1000);

    this.logger.debug(`Started health check interval (${intervalMinutes} minutes)`);
  }

  /**
   * Stop health check interval
   */
  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.logger.debug('Stopped health check interval');
    }
  }

  /**
   * Get system information
   */
  getSystemInfo(): {
    version: string;
    uptime: number;
    nodeVersion: string;
    platform: string;
    architecture: string;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    return {
      version: '1.0.0', // Would come from package.json
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Log structured event for monitoring
   */
  logEvent(event: string, data: Record<string, any>, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    const logEntry = {
      event,
      timestamp: new Date().toISOString(),
      ...data
    };

    switch (level) {
      case 'debug':
        this.logger.debug(`📊 ${event}`, logEntry);
        break;
      case 'info':
        this.logger.log(`📊 ${event}`, logEntry);
        break;
      case 'warn':
        this.logger.warn(`📊 ${event}`, logEntry);
        break;
      case 'error':
        this.logger.error(`📊 ${event}`, logEntry);
        break;
    }
  }

  /**
   * Log performance metrics
   */
  logPerformanceMetric(metric: string, value: number, unit: string, tags?: Record<string, string>): void {
    this.logEvent('performance_metric', {
      metric,
      value,
      unit,
      tags: tags || {}
    });
  }

  /**
   * Log business metrics
   */
  logBusinessMetric(metric: string, value: number, userId?: string, tags?: Record<string, string>): void {
    this.logEvent('business_metric', {
      metric,
      value,
      userId,
      tags: tags || {}
    });
  }

  /**
   * Create monitoring dashboard data
   */
  async getDashboardData(): Promise<{
    health: LangChainHealthStatus;
    metrics: LangChainMetrics;
    system: any;
    circuitBreakers?: Record<string, any>;
  }> {
    const health = await this.getHealthStatus();
    const metrics = await this.collectMetrics();
    const system = this.getSystemInfo();

    return {
      health,
      metrics,
      system,
      // Circuit breaker stats would be added here if available
    };
  }

  /**
   * Export metrics in Prometheus format (basic implementation)
   */
  exportPrometheusMetrics(): string {
    const metrics = this.lastHealthCheck?.metrics;
    if (!metrics) {
      return '# No metrics available\n';
    }

    let output = '# HELP langchain_total_executions Total number of LangChain executions\n';
    output += '# TYPE langchain_total_executions counter\n';
    output += `langchain_total_executions ${metrics.totalExecutions}\n\n`;

    output += '# HELP langchain_success_rate Success rate of LangChain executions\n';
    output += '# TYPE langchain_success_rate gauge\n';
    output += `langchain_success_rate ${metrics.successRate / 100}\n\n`;

    output += '# HELP langchain_average_response_time Average response time in milliseconds\n';
    output += '# TYPE langchain_average_response_time gauge\n';
    output += `langchain_average_response_time ${metrics.averageResponseTime}\n\n`;

    output += '# HELP langchain_error_rate Error rate percentage\n';
    output += '# TYPE langchain_error_rate gauge\n';
    output += `langchain_error_rate ${metrics.errorRate / 100}\n\n`;

    output += '# HELP langchain_memory_users Total users in memory\n';
    output += '# TYPE langchain_memory_users gauge\n';
    output += `langchain_memory_users ${metrics.memoryStats.totalUsers}\n\n`;

    output += '# HELP langchain_memory_messages Total messages in memory\n';
    output += '# TYPE langchain_memory_messages gauge\n';
    output += `langchain_memory_messages ${metrics.memoryStats.totalMessages}\n\n`;

    // Tool usage metrics
    for (const [toolName, count] of Object.entries(metrics.toolUsageStats)) {
      output += `# HELP langchain_tool_usage_${toolName} Usage count for ${toolName} tool\n`;
      output += `# TYPE langchain_tool_usage_${toolName} counter\n`;
      output += `langchain_tool_usage_${toolName} ${count}\n\n`;
    }

    return output;
  }
}