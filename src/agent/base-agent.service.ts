import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ConversationHistory<T = any> {
  userId: string;
  messages: T[];
  lastActivity: Date;
}

export abstract class BaseAgentService<TMessage = any> {
  protected abstract readonly logger: Logger;
  protected conversationHistory: Map<string, ConversationHistory<TMessage>> = new Map();
  
  // Shared configuration - single source of truth
  protected readonly HISTORY_LIMIT: number;
  protected readonly CLEANUP_INTERVAL: number;
  protected readonly HISTORY_EXPIRY: number;

  constructor(protected configService: ConfigService) {
    // Load from config with defaults (converted from hours to milliseconds)
    this.HISTORY_LIMIT = this.configService.get<number>('AGENT_HISTORY_LIMIT', 20);
    this.CLEANUP_INTERVAL = this.configService.get<number>('AGENT_CLEANUP_INTERVAL_HOURS', 1) * 60 * 60 * 1000;
    this.HISTORY_EXPIRY = this.configService.get<number>('AGENT_HISTORY_EXPIRY_HOURS', 24) * 60 * 60 * 1000;
  }

  protected startCleanupInterval(): void {
    setInterval(() => this.cleanupOldConversations(), this.CLEANUP_INTERVAL);
  }

  protected cleanupOldConversations(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [userId, history] of this.conversationHistory.entries()) {
      const timeDiff = now.getTime() - history.lastActivity.getTime();
      if (timeDiff > this.HISTORY_EXPIRY) {
        this.conversationHistory.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`🧹 Cleaned up ${cleaned} expired conversation(s)`);
    }
  }

  clearHistory(userId: string): void {
    this.conversationHistory.delete(userId);
    this.logger.log(`🗑️  Cleared conversation history for user: ${userId}`);
  }

  getHistoryStats(): { totalUsers: number; totalMessages: number } {
    let totalMessages = 0;
    for (const history of this.conversationHistory.values()) {
      totalMessages += history.messages.length;
    }

    return {
      totalUsers: this.conversationHistory.size,
      totalMessages,
    };
  }

  protected getUserHistory(userId: string): TMessage[] {
    const history = this.conversationHistory.get(userId);
    return history?.messages || [];
  }

  protected addToHistory(userId: string, message: TMessage): void {
    let history = this.conversationHistory.get(userId);

    if (!history) {
      history = {
        userId,
        messages: [],
        lastActivity: new Date(),
      };
      this.conversationHistory.set(userId, history);
    }

    history.messages.push(message);

    if (history.messages.length > this.HISTORY_LIMIT) {
      history.messages = history.messages.slice(-this.HISTORY_LIMIT);
    }

    history.lastActivity = new Date();
  }
}