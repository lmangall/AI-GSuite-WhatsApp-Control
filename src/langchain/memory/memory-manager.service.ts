import { Injectable, Logger } from '@nestjs/common';
import { BaseMessage } from '@langchain/core/messages';
import { LangChainConfigService } from '../config/langchain-config.service';
import { ILangChainMemoryManager, MemoryStats, UserMemoryInfo, InMemoryChatHistory, SimpleBufferMemory } from './memory-manager.interface';

@Injectable()
export class LangChainMemoryManagerService implements ILangChainMemoryManager {
  private readonly logger = new Logger(LangChainMemoryManagerService.name);
  private readonly userMemories = new Map<string, InMemoryChatHistory>();
  private readonly userMemoryInfo = new Map<string, UserMemoryInfo>();
  private readonly bufferMemories = new Map<string, SimpleBufferMemory>();
  private readonly summaryMemories = new Map<string, SimpleBufferMemory>();
  
  constructor(private readonly configService: LangChainConfigService) {
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Create or get existing ChatMessageHistory for a user
   */
  createMemoryForUser(userId: string): InMemoryChatHistory {
    if (this.userMemories.has(userId)) {
      const memory = this.userMemories.get(userId)!;
      this.updateLastAccessed(userId);
      return memory;
    }

    const memory = new InMemoryChatHistory();
    this.userMemories.set(userId, memory);
    
    // Track memory info
    this.userMemoryInfo.set(userId, {
      userId,
      messageCount: 0,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      memoryType: this.configService.getMemoryType() as 'buffer' | 'summary'
    });

    this.logger.debug(`Created new memory for user: ${userId}`);
    return memory;
  }

  /**
   * Get existing memory for a user
   */
  getMemory(userId: string): InMemoryChatHistory | null {
    const memory = this.userMemories.get(userId);
    if (memory) {
      this.updateLastAccessed(userId);
    }
    return memory || null;
  }

  /**
   * Clear memory for a specific user
   */
  clearMemory(userId: string): void {
    this.userMemories.delete(userId);
    this.userMemoryInfo.delete(userId);
    this.bufferMemories.delete(userId);
    this.summaryMemories.delete(userId);
    this.logger.debug(`Cleared memory for user: ${userId}`);
  }

  /**
   * Create ConversationBufferMemory for a user
   */
  createBufferMemory(userId: string): SimpleBufferMemory {
    if (this.bufferMemories.has(userId)) {
      return this.bufferMemories.get(userId)!;
    }

    const chatHistory = this.createMemoryForUser(userId);
    const bufferMemory = new SimpleBufferMemory(chatHistory, 'chat_history', true);

    this.bufferMemories.set(userId, bufferMemory);
    this.logger.debug(`Created buffer memory for user: ${userId}`);
    return bufferMemory;
  }

  /**
   * Create ConversationSummaryMemory for a user
   */
  createSummaryMemory(userId: string): SimpleBufferMemory {
    if (this.summaryMemories.has(userId)) {
      return this.summaryMemories.get(userId)!;
    }

    const chatHistory = this.createMemoryForUser(userId);
    
    // Note: ConversationSummaryMemory requires an LLM for summarization
    // This would need to be configured with the actual LLM instance
    // For now, we'll create a simple buffer memory as placeholder
    const summaryMemory = new SimpleBufferMemory(chatHistory, 'chat_history', true);

    this.summaryMemories.set(userId, summaryMemory);
    this.logger.debug(`Created summary memory for user: ${userId}`);
    return summaryMemory;
  }

  /**
   * Clean up expired memories based on configuration
   */
  cleanupExpiredMemories(): void {
    const expiryHours = this.configService.getMemoryExpiryHours();
    const expiryTime = new Date(Date.now() - expiryHours * 60 * 60 * 1000);
    
    let cleanedCount = 0;
    
    for (const [userId, memoryInfo] of this.userMemoryInfo.entries()) {
      if (memoryInfo.lastAccessedAt < expiryTime) {
        this.clearMemory(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} expired memories`);
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    const totalUsers = this.userMemories.size;
    let totalMessages = 0;
    const memoryUsageByUser: Record<string, number> = {};
    let oldestTimestamp: Date | undefined;
    let newestTimestamp: Date | undefined;

    for (const [userId, memoryInfo] of this.userMemoryInfo.entries()) {
      memoryUsageByUser[userId] = memoryInfo.messageCount;
      totalMessages += memoryInfo.messageCount;

      if (!oldestTimestamp || memoryInfo.createdAt < oldestTimestamp) {
        oldestTimestamp = memoryInfo.createdAt;
      }
      if (!newestTimestamp || memoryInfo.lastAccessedAt > newestTimestamp) {
        newestTimestamp = memoryInfo.lastAccessedAt;
      }
    }

    return {
      totalUsers,
      totalMessages,
      memoryUsageByUser,
      oldestMemoryTimestamp: oldestTimestamp,
      newestMemoryTimestamp: newestTimestamp,
    };
  }

  /**
   * Add a message to user's memory and update tracking info
   */
  async addMessageToMemory(userId: string, message: BaseMessage): Promise<void> {
    const memory = this.createMemoryForUser(userId);
    await memory.addMessage(message);
    
    // Update message count
    const memoryInfo = this.userMemoryInfo.get(userId);
    if (memoryInfo) {
      memoryInfo.messageCount++;
      memoryInfo.lastAccessedAt = new Date();
    }
  }

  /**
   * Get messages from user's memory
   */
  async getMessagesFromMemory(userId: string): Promise<BaseMessage[]> {
    const memory = this.getMemory(userId);
    if (!memory) {
      return [];
    }
    
    return await memory.getMessages();
  }

  /**
   * Check if memory needs cleanup based on token limits
   */
  async shouldCleanupMemory(userId: string): Promise<boolean> {
    const memory = this.getMemory(userId);
    if (!memory) {
      return false;
    }

    const messages = await memory.getMessages();
    const maxTokens = this.configService.getMaxTokens();
    
    // Rough estimation: average 4 characters per token
    const estimatedTokens = messages.reduce((total, msg) => {
      return total + Math.ceil(msg.content.toString().length / 4);
    }, 0);

    return estimatedTokens > maxTokens * 0.8; // Cleanup when 80% of limit reached
  }

  /**
   * Truncate old messages when memory limit is reached
   */
  async truncateMemoryIfNeeded(userId: string): Promise<void> {
    if (await this.shouldCleanupMemory(userId)) {
      const memory = this.getMemory(userId);
      if (!memory) {
        return;
      }

      const messages = await memory.getMessages();
      const keepCount = Math.floor(messages.length * 0.5); // Keep 50% of messages
      const messagesToKeep = messages.slice(-keepCount);

      // Clear and re-add messages
      await memory.clear();
      for (const message of messagesToKeep) {
        await memory.addMessage(message);
      }

      // Update tracking info
      const memoryInfo = this.userMemoryInfo.get(userId);
      if (memoryInfo) {
        memoryInfo.messageCount = messagesToKeep.length;
        memoryInfo.lastAccessedAt = new Date();
      }

      this.logger.debug(`Truncated memory for user ${userId}, kept ${keepCount} messages`);
    }
  }

  /**
   * Update last accessed timestamp for a user
   */
  private updateLastAccessed(userId: string): void {
    const memoryInfo = this.userMemoryInfo.get(userId);
    if (memoryInfo) {
      memoryInfo.lastAccessedAt = new Date();
    }
  }

  /**
   * Start periodic cleanup of expired memories
   */
  private startCleanupInterval(): void {
    const intervalMinutes = 60; // Run cleanup every hour
    setInterval(() => {
      this.cleanupExpiredMemories();
    }, intervalMinutes * 60 * 1000);
    
    this.logger.log(`Started memory cleanup interval (${intervalMinutes} minutes)`);
  }
}