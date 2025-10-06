import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiAgentService } from './gemini-agent.service';
import { OpenAIAgentService } from './openai-agent.service';
import { LangChainAgentService } from '../langchain/agent/langchain-agent.service';
import { LangChainCircuitBreakerService, LANGCHAIN_CIRCUIT_CONFIGS } from '../langchain/circuit-breaker/circuit-breaker.service';
import { IAgentService } from './agent.interface';

@Injectable()
export class AgentFactoryService implements IAgentService {
  private readonly logger = new Logger(AgentFactoryService.name);
  private primaryProvider: IAgentService;
  private fallbackProvider: IAgentService;
  private emergencyFallbackProvider: IAgentService;
  private currentProvider: IAgentService;
  private useLangChain: boolean;

  constructor(
    private configService: ConfigService,
    private geminiService: GeminiAgentService,
    private openaiService: OpenAIAgentService,
    private langChainService: LangChainAgentService,
    private circuitBreaker: LangChainCircuitBreakerService,
  ) {
    // Check if LangChain should be used
    this.useLangChain = configService.get<boolean>('USE_LANGCHAIN', true);
    
    if (this.useLangChain) {
      // LangChain as primary, existing agents as fallback
      this.primaryProvider = langChainService;
      
      const provider = configService.get<string>('AI_PROVIDER', 'gemini').toLowerCase();
      if (provider === 'openai') {
        this.fallbackProvider = openaiService;
        this.emergencyFallbackProvider = geminiService;
      } else {
        this.fallbackProvider = geminiService;
        this.emergencyFallbackProvider = openaiService;
      }
      
      this.logger.log('🚀 Primary: LangChain | Fallback: Legacy Agents');
    } else {
      // Legacy behavior
      const provider = configService.get<string>('AI_PROVIDER', 'gemini').toLowerCase();
      
      if (provider === 'openai') {
        this.primaryProvider = openaiService;
        this.fallbackProvider = geminiService;
      } else {
        this.primaryProvider = geminiService;
        this.fallbackProvider = openaiService;
      }
      
      this.emergencyFallbackProvider = langChainService;
      this.logger.log('🤖 Primary: Legacy Agents | Emergency Fallback: LangChain');
    }
    
    this.currentProvider = this.primaryProvider;
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    // Use circuit breaker for LangChain operations
    if (this.useLangChain && this.currentProvider === this.primaryProvider) {
      try {
        return await this.circuitBreaker.execute(
          'langchain_agent_execution',
          async () => {
            return await (this.primaryProvider as LangChainAgentService).processMessageWithIntent(userId, userMessage, requestId);
          },
          LANGCHAIN_CIRCUIT_CONFIGS.AGENT_EXECUTION
        );
      } catch (error) {
        this.logger.warn(`[${requestId}] ⚠️ LangChain circuit breaker triggered or execution failed: ${error.message}`);
        
        // Fallback to legacy agents when circuit breaker is open
        return await this.processWithFallback(userId, userMessage, requestId);
      }
    } else {
      // Legacy agent processing
      try {
        return await this.currentProvider.processMessage(userId, userMessage, requestId);
      } catch (error) {
        this.logger.warn(`[${requestId}] ⚠️ Primary provider (${this.currentProvider.constructor.name}) failed: ${error.message}`);
        return await this.processWithFallback(userId, userMessage, requestId);
      }
    }
  }

  /**
   * Process message with fallback chain
   */
  private async processWithFallback(userId: string, userMessage: string, requestId: string): Promise<string> {
    // Try fallback provider
    try {
      const response = await this.fallbackProvider.processMessage(userId, userMessage, requestId);
      this.logger.log(`[${requestId}] ✅ Fallback provider successful`);
      return response;
    } catch (fallbackError) {
      this.logger.error(`[${requestId}] ❌ Fallback provider also failed: ${fallbackError.message}`);
      
      // Try emergency fallback if available
      if (this.emergencyFallbackProvider) {
        try {
          const response = await this.emergencyFallbackProvider.processMessage(userId, userMessage, requestId);
          this.logger.log(`[${requestId}] ✅ Emergency fallback successful`);
          return response;
        } catch (emergencyError) {
          this.logger.error(`[${requestId}] ❌ Emergency fallback also failed: ${emergencyError.message}`);
        }
      }
      
      throw new Error('All AI providers are unavailable. Please try again later.');
    }
  }

  /**
   * Process message with explicit intent (LangChain only)
   */
  async processMessageWithIntent(userId: string, userMessage: string, requestId: string): Promise<string> {
    if (this.useLangChain && this.primaryProvider instanceof LangChainAgentService) {
      try {
        return await this.circuitBreaker.execute(
          'langchain_intent_processing',
          async () => {
            return await (this.primaryProvider as LangChainAgentService).processMessageWithIntent(userId, userMessage, requestId);
          },
          LANGCHAIN_CIRCUIT_CONFIGS.AGENT_EXECUTION
        );
      } catch (error) {
        this.logger.warn(`[${requestId}] ⚠️ LangChain intent processing failed or circuit breaker triggered, falling back to regular processing`);
        return await this.processMessage(userId, userMessage, requestId);
      }
    } else {
      // Fallback to regular processing for non-LangChain providers
      return await this.processMessage(userId, userMessage, requestId);
    }
  }

  /**
   * Get agent health status
   */
  async getAgentHealthStatus(): Promise<{
    primary: { name: string; available: boolean };
    fallback: { name: string; available: boolean };
    emergency?: { name: string; available: boolean };
  }> {
    const status = {
      primary: {
        name: this.primaryProvider.constructor.name,
        available: false
      },
      fallback: {
        name: this.fallbackProvider.constructor.name,
        available: false
      }
    };

    // Check primary provider health
    try {
      await this.primaryProvider.processMessage('health-check', 'test', 'health-check');
      status.primary.available = true;
    } catch (error) {
      this.logger.debug(`Primary provider health check failed: ${error.message}`);
    }

    // Check fallback provider health
    try {
      await this.fallbackProvider.processMessage('health-check', 'test', 'health-check');
      status.fallback.available = true;
    } catch (error) {
      this.logger.debug(`Fallback provider health check failed: ${error.message}`);
    }

    // Check emergency fallback if available
    if (this.emergencyFallbackProvider) {
      const emergencyStatus = {
        name: this.emergencyFallbackProvider.constructor.name,
        available: false
      };

      try {
        await this.emergencyFallbackProvider.processMessage('health-check', 'test', 'health-check');
        emergencyStatus.available = true;
      } catch (error) {
        this.logger.debug(`Emergency fallback health check failed: ${error.message}`);
      }

      return { ...status, emergency: emergencyStatus };
    }

    return status;
  }

  /**
   * Switch to fallback provider manually
   */
  switchToFallback(): void {
    this.currentProvider = this.fallbackProvider;
    this.logger.warn(`🔄 Manually switched to fallback provider: ${this.currentProvider.constructor.name}`);
  }

  /**
   * Switch back to primary provider
   */
  switchToPrimary(): void {
    this.currentProvider = this.primaryProvider;
    this.logger.log(`🔄 Switched back to primary provider: ${this.currentProvider.constructor.name}`);
  }

  /**
   * Get current provider information
   */
  getCurrentProviderInfo(): { name: string; isLangChain: boolean; isPrimary: boolean } {
    return {
      name: this.currentProvider.constructor.name,
      isLangChain: this.currentProvider instanceof LangChainAgentService,
      isPrimary: this.currentProvider === this.primaryProvider
    };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Record<string, any> {
    return this.circuitBreaker.getAllStats();
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    this.circuitBreaker.reset('langchain_agent_execution');
    this.circuitBreaker.reset('langchain_intent_processing');
    this.logger.log('All circuit breakers have been reset');
  }

  /**
   * Force circuit breakers open (for maintenance)
   */
  forceCircuitBreakersOpen(): void {
    this.circuitBreaker.forceOpen('langchain_agent_execution');
    this.circuitBreaker.forceOpen('langchain_intent_processing');
    this.logger.warn('All circuit breakers have been forced open');
  }

  clearHistory(userId: string): void {
    this.currentProvider.clearHistory(userId);
  }

  getHistoryStats(): { totalUsers: number; totalMessages: number } {
    return this.currentProvider.getHistoryStats();
  }
}