import { BaseMessage } from '@langchain/core/messages';

export interface ILangChainMemoryManager {
  // LangChain native memory operations
  createMemoryForUser(userId: string): InMemoryChatHistory;
  getMemory(userId: string): InMemoryChatHistory | null;
  clearMemory(userId: string): void;
  
  // Memory strategies
  createBufferMemory(userId: string): SimpleBufferMemory;
  createSummaryMemory(userId: string): SimpleBufferMemory;
  
  // Cleanup and maintenance
  cleanupExpiredMemories(): void;
  getMemoryStats(): { totalUsers: number; totalMessages: number };
}

// Simple in-memory chat history implementation
export class InMemoryChatHistory {
  private messages: BaseMessage[] = [];

  async addMessage(message: BaseMessage): Promise<void> {
    this.messages.push(message);
  }

  async getMessages(): Promise<BaseMessage[]> {
    return [...this.messages];
  }

  async clear(): Promise<void> {
    this.messages = [];
  }
}

// Simple buffer memory implementation
export class SimpleBufferMemory {
  constructor(
    private chatHistory: InMemoryChatHistory,
    private memoryKey: string = 'chat_history',
    private returnMessages: boolean = true
  ) {}

  async loadMemoryVariables(): Promise<Record<string, any>> {
    const messages = await this.chatHistory.getMessages();
    return { [this.memoryKey]: this.returnMessages ? messages : messages.map(m => m.content).join('\n') };
  }

  async saveContext(inputs: Record<string, any>, outputs: Record<string, any>): Promise<void> {
    // Implementation would save context to chat history
  }

  async clear(): Promise<void> {
    await this.chatHistory.clear();
  }
}

export interface MemoryStats {
  totalUsers: number;
  totalMessages: number;
  memoryUsageByUser: Record<string, number>;
  oldestMemoryTimestamp?: Date;
  newestMemoryTimestamp?: Date;
}

export interface UserMemoryInfo {
  userId: string;
  messageCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
  memoryType: 'buffer' | 'summary';
}