export interface IAgentService {
    processMessage(userId: string, userMessage: string, requestId: string): Promise<string>;
    clearHistory(userId: string): void;
    getHistoryStats(): { totalUsers: number; totalMessages: number };
  }