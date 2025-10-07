import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { LangChainConfigService } from '../config/langchain-config.service';
import { LangChainMonitoringService } from '../monitoring/langchain-monitoring.service';
import { LangChainAgentService } from '../agent/langchain-agent.service';
import { LangChainToolManagerService } from '../tools/tool-manager.service';
import { LangChainMemoryManagerService } from '../memory/memory-manager.service';
import { StructuredLoggerService } from '../logging/structured-logger.service';

export interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  componentStatus: Record<string, 'ok' | 'warning' | 'error'>;
  startupTime: number;
}

@Injectable()
export class StartupValidationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupValidationService.name);
  private startupTime = Date.now();

  constructor(
    private readonly configService: LangChainConfigService,
    private readonly monitoringService: LangChainMonitoringService,
    private readonly agentService: LangChainAgentService,
    private readonly toolManager: LangChainToolManagerService,
    private readonly memoryManager: LangChainMemoryManagerService,
    private readonly structuredLogger: StructuredLoggerService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('🚀 Starting LangChain integration startup validation...');
    
    try {
      const result = await this.validateStartup();
      
      if (result.success) {
        this.logger.log(`✅ LangChain integration startup validation completed successfully in ${result.startupTime}ms`);
        this.logStartupSuccess(result);
      } else {
        this.logger.error(`❌ LangChain integration startup validation failed after ${result.startupTime}ms`);
        this.logStartupFailure(result);
        
        // Don't throw error to prevent app from crashing, but log critical issues
        if (result.errors.length > 0) {
          this.logger.error('Critical startup errors:', result.errors);
        }
      }
      
      if (result.warnings.length > 0) {
        this.logger.warn('Startup warnings:', result.warnings);
      }
      
    } catch (error) {
      this.logger.error('Startup validation crashed:', error);
      this.structuredLogger.log({
        level: 'error',
        component: 'startup-validation',
        event: 'startup_validation_crashed',
        message: 'Startup validation process crashed',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      });
    }
  }

  /**
   * Perform comprehensive startup validation
   */
  async validateStartup(): Promise<StartupValidationResult> {
    const startTime = Date.now();
    const result: StartupValidationResult = {
      success: true,
      errors: [],
      warnings: [],
      componentStatus: {},
      startupTime: 0
    };

    // Validate configuration
    await this.validateConfiguration(result);
    
    // Validate agent service
    await this.validateAgentService(result);
    
    // Validate tool manager
    await this.validateToolManager(result);
    
    // Validate memory manager
    await this.validateMemoryManager(result);
    
    // Validate monitoring service
    await this.validateMonitoringService(result);
    
    // Check overall health
    await this.validateOverallHealth(result);

    result.startupTime = Date.now() - startTime;
    result.success = result.errors.length === 0;

    return result;
  }

  /**
   * Validate configuration
   */
  private async validateConfiguration(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating configuration...');
      
      const validation = this.configService.validateConfiguration();
      
      if (validation.isValid) {
        result.componentStatus['configuration'] = 'ok';
        this.logger.debug('✅ Configuration validation passed');
      } else {
        result.componentStatus['configuration'] = 'error';
        result.errors.push(`Configuration validation failed: ${validation.errors.join(', ')}`);
        this.logger.error('❌ Configuration validation failed:', validation.errors);
      }
      
    } catch (error) {
      result.componentStatus['configuration'] = 'error';
      result.errors.push(`Configuration validation error: ${error.message}`);
      this.logger.error('❌ Configuration validation error:', error);
    }
  }

  /**
   * Validate agent service
   */
  private async validateAgentService(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating agent service...');
      
      // Check if agent is initialized
      const modelHealth = await this.agentService.getModelHealthStatus();
      
      if (modelHealth.primary.available || modelHealth.fallback.available) {
        result.componentStatus['agent'] = 'ok';
        this.logger.debug('✅ Agent service validation passed');
        
        if (!modelHealth.primary.available) {
          result.warnings.push('Primary model is not available, using fallback');
        }
        if (!modelHealth.fallback.available) {
          result.warnings.push('Fallback model is not available');
        }
      } else {
        result.componentStatus['agent'] = 'error';
        result.errors.push('No AI models are available');
        this.logger.error('❌ No AI models are available');
      }
      
    } catch (error) {
      result.componentStatus['agent'] = 'error';
      result.errors.push(`Agent service validation error: ${error.message}`);
      this.logger.error('❌ Agent service validation error:', error);
    }
  }

  /**
   * Validate tool manager
   */
  private async validateToolManager(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating tool manager...');
      
      const toolStats = this.toolManager.getToolStats();
      
      if (toolStats.totalTools > 0) {
        result.componentStatus['tools'] = 'ok';
        this.logger.debug(`✅ Tool manager validation passed (${toolStats.totalTools} tools available)`);
      } else {
        result.componentStatus['tools'] = 'warning';
        result.warnings.push('No tools are available');
        this.logger.warn('⚠️ No tools are available');
      }
      
    } catch (error) {
      result.componentStatus['tools'] = 'error';
      result.errors.push(`Tool manager validation error: ${error.message}`);
      this.logger.error('❌ Tool manager validation error:', error);
    }
  }

  /**
   * Validate memory manager
   */
  private async validateMemoryManager(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating memory manager...');
      
      const memoryStats = this.memoryManager.getMemoryStats();
      
      // Memory manager should always be available
      result.componentStatus['memory'] = 'ok';
      this.logger.debug('✅ Memory manager validation passed');
      
    } catch (error) {
      result.componentStatus['memory'] = 'error';
      result.errors.push(`Memory manager validation error: ${error.message}`);
      this.logger.error('❌ Memory manager validation error:', error);
    }
  }

  /**
   * Validate monitoring service
   */
  private async validateMonitoringService(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating monitoring service...');
      
      const healthStatus = await this.monitoringService.getHealthStatus();
      
      if (healthStatus.overall === 'healthy' || healthStatus.overall === 'degraded') {
        result.componentStatus['monitoring'] = 'ok';
        this.logger.debug('✅ Monitoring service validation passed');
        
        if (healthStatus.overall === 'degraded') {
          result.warnings.push('System is in degraded state');
        }
      } else {
        result.componentStatus['monitoring'] = 'warning';
        result.warnings.push('System health is unhealthy');
        this.logger.warn('⚠️ System health is unhealthy');
      }
      
    } catch (error) {
      result.componentStatus['monitoring'] = 'error';
      result.errors.push(`Monitoring service validation error: ${error.message}`);
      this.logger.error('❌ Monitoring service validation error:', error);
    }
  }

  /**
   * Validate overall health
   */
  private async validateOverallHealth(result: StartupValidationResult): Promise<void> {
    try {
      this.logger.debug('Validating overall health...');
      
      const criticalComponents = ['configuration', 'agent'];
      const criticalErrors = criticalComponents.filter(
        component => result.componentStatus[component] === 'error'
      );
      
      if (criticalErrors.length === 0) {
        this.logger.debug('✅ Overall health validation passed');
      } else {
        result.errors.push(`Critical components failed: ${criticalErrors.join(', ')}`);
        this.logger.error(`❌ Critical components failed: ${criticalErrors.join(', ')}`);
      }
      
    } catch (error) {
      result.errors.push(`Overall health validation error: ${error.message}`);
      this.logger.error('❌ Overall health validation error:', error);
    }
  }

  /**
   * Log successful startup
   */
  private logStartupSuccess(result: StartupValidationResult): void {
    this.structuredLogger.log({
      level: 'info',
      component: 'startup-validation',
      event: 'startup_success',
      message: 'LangChain integration started successfully',
      duration: result.startupTime,
      metadata: {
        componentStatus: result.componentStatus,
        warningCount: result.warnings.length,
        totalComponents: Object.keys(result.componentStatus).length
      }
    });
  }

  /**
   * Log startup failure
   */
  private logStartupFailure(result: StartupValidationResult): void {
    this.structuredLogger.log({
      level: 'error',
      component: 'startup-validation',
      event: 'startup_failure',
      message: 'LangChain integration startup failed',
      duration: result.startupTime,
      metadata: {
        componentStatus: result.componentStatus,
        errors: result.errors,
        warnings: result.warnings,
        errorCount: result.errors.length,
        warningCount: result.warnings.length
      }
    });
  }

  /**
   * Get current startup status
   */
  async getCurrentStatus(): Promise<StartupValidationResult> {
    return await this.validateStartup();
  }
}