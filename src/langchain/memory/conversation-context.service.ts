import { Injectable, Logger } from '@nestjs/common';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { LangChainMemoryManagerService } from './memory-manager.service';
import { LangChainConfigService } from '../config/langchain-config.service';

export interface ConversationContext {
  userId: string;
  messages: BaseMessage[];
  tokenCount: number;
  lastUpdated: Date;
  summarized: boolean;
}

export interface ContextStats {
  totalContexts: number;
  averageTokensPerContext: number;
  contextsNeedingSummarization: number;
  totalTokensAcrossAllContexts: number;
}

@Injectable()
export class ConversationContextService {
  private readonly logger = new Logger(ConversationContextService.name);
  private readonly contextCache = new Map<string, ConversationContext>();

  constructor(
    private readonly memoryManager: LangChainMemoryManagerService,
    private readonly configService: LangChainConfigService,
  ) {}

  /**
   * Add a message to the conversation context
   */
  async addToContext(userId: string, message: string, isUser: boolean = true): Promise<void> {
    try {
      const baseMessage = isUser 
        ? new HumanMessage(message)
        : new AIMessage(message);

      // Add to memory manager
      await this.memoryManager.addMessageToMemory(userId, baseMessage);

      // Update context cache
      await this.updateContextCache(userId);

      // Check if summarization is needed
      await this.checkAndSummarizeIfNeeded(userId);

      this.logger.debug(`Added ${isUser ? 'user' : 'AI'} message to context for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to add message to context for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversation context for a user
   */
  async getContext(userId: string): Promise<ConversationContext | null> {
    try {
      // Check cache first
      if (this.contextCache.has(userId)) {
        const cachedContext = this.contextCache.get(userId)!;
        // Return cached context if it's recent (within 5 minutes)
        if (Date.now() - cachedContext.lastUpdated.getTime() < 5 * 60 * 1000) {
          return cachedContext;
        }
      }

      // Fetch from memory manager
      const messages = await this.memoryManager.getMessagesFromMemory(userId);
      if (messages.length === 0) {
        return null;
      }

      const context: ConversationContext = {
        userId,
        messages,
        tokenCount: this.estimateTokenCount(messages),
        lastUpdated: new Date(),
        summarized: false,
      };

      // Update cache
      this.contextCache.set(userId, context);
      return context;
    } catch (error) {
      this.logger.error(`Failed to get context for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Clear context for a user
   */
  async clearContext(userId: string): Promise<void> {
    try {
      this.memoryManager.clearMemory(userId);
      this.contextCache.delete(userId);
      this.logger.debug(`Cleared context for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to clear context for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get context summary for a user (last N messages)
   */
  async getContextSummary(userId: string, messageCount: number = 10): Promise<BaseMessage[]> {
    try {
      const context = await this.getContext(userId);
      if (!context) {
        return [];
      }

      // Return last N messages
      return context.messages.slice(-messageCount);
    } catch (error) {
      this.logger.error(`Failed to get context summary for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Check if context needs summarization and perform it if needed
   */
  async checkAndSummarizeIfNeeded(userId: string): Promise<void> {
    try {
      const shouldCleanup = await this.memoryManager.shouldCleanupMemory(userId);
      if (shouldCleanup) {
        await this.summarizeContext(userId);
      }
    } catch (error) {
      this.logger.error(`Failed to check/summarize context for user ${userId}:`, error);
    }
  }

  /**
   * Summarize context when token limits are exceeded
   */
  async summarizeContext(userId: string): Promise<void> {
    try {
      const context = await this.getContext(userId);
      if (!context) {
        return;
      }

      const maxTokens = this.configService.getMaxTokens();
      if (context.tokenCount <= maxTokens * 0.8) {
        return; // No summarization needed
      }

      // For now, we'll use simple truncation
      // In a full implementation, this would use an LLM to create a summary
      await this.memoryManager.truncateMemoryIfNeeded(userId);

      // Update cache
      this.contextCache.delete(userId);
      await this.updateContextCache(userId);

      this.logger.debug(`Summarized context for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to summarize context for user ${userId}:`, error);
    }
  }

  /**
   * Get statistics about all conversation contexts
   */
  getContextStats(): ContextStats {
    let totalTokens = 0;
    let contextsNeedingSummarization = 0;
    const maxTokens = this.configService.getMaxTokens();

    for (const context of this.contextCache.values()) {
      totalTokens += context.tokenCount;
      if (context.tokenCount > maxTokens * 0.8) {
        contextsNeedingSummarization++;
      }
    }

    return {
      totalContexts: this.contextCache.size,
      averageTokensPerContext: this.contextCache.size > 0 ? totalTokens / this.contextCache.size : 0,
      contextsNeedingSummarization,
      totalTokensAcrossAllContexts: totalTokens,
    };
  }

  /**
   * Get formatted context for prompt inclusion
   */
  async getFormattedContext(userId: string, maxMessages: number = 20): Promise<string> {
    try {
      const messages = await this.getContextSummary(userId, maxMessages);
      if (messages.length === 0) {
        return '';
      }

      return messages
        .map(msg => {
          const role = msg._getType() === 'human' ? 'User' : 'Assistant';
          return `${role}: ${msg.content}`;
        })
        .join('\n');
    } catch (error) {
      this.logger.error(`Failed to get formatted context for user ${userId}:`, error);
      return '';
    }
  }

  /**
   * Check if user has active conversation context
   */
  async hasActiveContext(userId: string): Promise<boolean> {
    try {
      const context = await this.getContext(userId);
      return context !== null && context.messages.length > 0;
    } catch (error) {
      this.logger.error(`Failed to check active context for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get conversation context length for a user
   */
  async getContextLength(userId: string): Promise<number> {
    try {
      const context = await this.getContext(userId);
      return context ? context.messages.length : 0;
    } catch (error) {
      this.logger.error(`Failed to get context length for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Update context cache for a user
   */
  private async updateContextCache(userId: string): Promise<void> {
    const messages = await this.memoryManager.getMessagesFromMemory(userId);
    const context: ConversationContext = {
      userId,
      messages,
      tokenCount: this.estimateTokenCount(messages),
      lastUpdated: new Date(),
      summarized: false,
    };
    this.contextCache.set(userId, context);
  }

  /**
   * Estimate token count for messages (rough approximation)
   */
  private estimateTokenCount(messages: BaseMessage[]): number {
    return messages.reduce((total, message) => {
      // Rough estimation: 4 characters per token
      return total + Math.ceil(message.content.toString().length / 4);
    }, 0);
  }

  /**
   * Cleanup expired contexts from cache
   */
  private cleanupExpiredContexts(): void {
    const expiryTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes
    
    for (const [userId, context] of this.contextCache.entries()) {
      if (context.lastUpdated < expiryTime) {
        this.contextCache.delete(userId);
      }
    }
  }

  /**
   * Start periodic cleanup of expired contexts
   */
  onModuleInit(): void {
    // Cleanup expired contexts every 15 minutes
    setInterval(() => {
      this.cleanupExpiredContexts();
    }, 15 * 60 * 1000);
    
    this.logger.log('Started conversation context cleanup interval');
  }
}