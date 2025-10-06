import { Injectable, Logger } from '@nestjs/common';
import { FastIntentRouterService, FastRouteResult } from './intent/fast-intent-router.service';
import { LangChainAgentService } from './agent/langchain-agent.service';

@Injectable()
export class LangChainRouterService {
  private readonly logger = new Logger(LangChainRouterService.name);

  constructor(
    private fastIntentRouter: FastIntentRouterService,
    private langChainAgent: LangChainAgentService
  ) {}

  /**
   * Main entry point for processing messages with intelligent routing
   */
  async processMessage(userId: string, message: string, requestId: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`🚀 [${requestId}] Processing message for user ${userId}: "${message}"`);
      
      // Try fast-path routing first
      const fastRoute = await this.fastIntentRouter.routeMessage(message, userId);
      
      if (fastRoute.shouldUseFastPath && fastRoute.response) {
        const duration = Date.now() - startTime;
        this.logger.log(`⚡ [${requestId}] Fast-path response completed in ${duration}ms (intent: ${fastRoute.intent})`);
        this.logger.debug(`⚡ [${requestId}] Fast-path response (${fastRoute.response.length} chars): "${fastRoute.response.substring(0, 100)}..."`);
        return fastRoute.response;
      }
      
      // Fall back to full agent processing for complex queries
      this.logger.log(`🔄 [${requestId}] Using full agent processing for complex query`);
      const response = await this.langChainAgent.processMessage(userId, message, requestId);
      
      const duration = Date.now() - startTime;
      this.logger.log(`✅ [${requestId}] Full agent processing completed in ${duration}ms`);
      
      return response;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ [${requestId}] Message processing failed after ${duration}ms:`, error);
      
      // Provide a graceful fallback response
      return "I apologize, but I'm having trouble processing your request right now. Please try again in a moment.";
    }
  }

  /**
   * Get routing statistics for monitoring
   */
  getRoutingStats() {
    return this.fastIntentRouter.getRoutingStats();
  }

  /**
   * Health check for the routing service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      // Check if fast routing is working
      const testFastRoute = await this.fastIntentRouter.routeMessage('hi', 'test-user');
      const fastRoutingWorking = testFastRoute.shouldUseFastPath;
      
      // Check if agent is available
      const agentHealthy = this.langChainAgent.getPrimaryModel() !== null;
      
      if (fastRoutingWorking && agentHealthy) {
        return {
          status: 'healthy',
          details: {
            fastRouting: 'working',
            agent: 'available',
            timestamp: new Date().toISOString()
          }
        };
      } else if (fastRoutingWorking) {
        return {
          status: 'degraded',
          details: {
            fastRouting: 'working',
            agent: 'unavailable',
            message: 'Fast responses available, complex queries may fail',
            timestamp: new Date().toISOString()
          }
        };
      } else {
        return {
          status: 'unhealthy',
          details: {
            fastRouting: 'failed',
            agent: agentHealthy ? 'available' : 'unavailable',
            timestamp: new Date().toISOString()
          }
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
}