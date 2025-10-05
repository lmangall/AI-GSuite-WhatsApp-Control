import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiAgentService } from './gemini-agent.service';
import { OpenAIAgentService } from './openai-agent.service';
import { IAgentService } from './agent.interface';

@Injectable()
export class AgentFactoryService implements IAgentService {
  private readonly logger = new Logger(AgentFactoryService.name);
  private primaryProvider: IAgentService;
  private fallbackProvider: IAgentService;
  private currentProvider: IAgentService;

  constructor(
    private configService: ConfigService,
    private geminiService: GeminiAgentService,
    private openaiService: OpenAIAgentService,
  ) {
    const provider = configService.get<string>('AI_PROVIDER', 'gemini').toLowerCase();
    
    if (provider === 'openai') {
      this.primaryProvider = openaiService;
      this.fallbackProvider = geminiService;
      this.logger.log('🤖 Primary: OpenAI | Fallback: Gemini');
    } else {
      this.primaryProvider = geminiService;
      this.fallbackProvider = openaiService;
      this.logger.log('🤖 Primary: Gemini | Fallback: OpenAI');
    }
    
    this.currentProvider = this.primaryProvider;
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      return await this.currentProvider.processMessage(userId, userMessage, requestId);
    } catch (error) {
      // Check if it's a quota/rate limit error
      const isQuotaError = error.message?.includes('429') || 
                          error.message?.includes('quota') || 
                          error.message?.includes('Too Many Requests');

      if (isQuotaError) {
        this.logger.warn(`[${requestId}] ⚠️  Quota exceeded on ${this.currentProvider.constructor.name}, switching to fallback`);
        
        try {
          // Try fallback provider
          const response = await this.fallbackProvider.processMessage(userId, userMessage, requestId);
          this.logger.log(`[${requestId}] ✅ Fallback successful`);
          return response;
        } catch (fallbackError) {
          this.logger.error(`[${requestId}] ❌ Fallback also failed: ${fallbackError.message}`);
          throw new Error('Both AI providers are unavailable. Please try again later.');
        }
      }

      // If not a quota error, just throw it
      throw error;
    }
  }

  clearHistory(userId: string): void {
    this.currentProvider.clearHistory(userId);
  }

  getHistoryStats(): { totalUsers: number; totalMessages: number } {
    return this.currentProvider.getHistoryStats();
  }
}