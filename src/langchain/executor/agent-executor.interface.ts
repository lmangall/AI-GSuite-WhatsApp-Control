import { AgentExecutor } from 'langchain/agents';
import { BaseMessage } from '@langchain/core/messages';
import { MessageContext, ToolExecutionResult } from '../interfaces/langchain-config.interface';

export interface ILangChainAgentExecutor {
  // Agent execution
  executeAgent(messageContext: MessageContext): Promise<AgentExecutionResult>;
  executeWithIntent(messageContext: MessageContext): Promise<AgentExecutionResult>;
  
  // Agent lifecycle
  initializeAgent(): Promise<void>;
  refreshAgent(): Promise<void>;
  
  // Monitoring and logging
  getExecutionStats(): AgentExecutionStats;
  getExecutionHistory(limit?: number): AgentExecutionResult[];
}

export interface AgentExecutionResult {
  success: boolean;
  response: string;
  toolsUsed: string[];
  executionTime: number;
  timestamp: Date;
  error?: string;
  intermediateSteps?: AgentStep[];
  tokensUsed?: number;
}

export interface AgentStep {
  action: string;
  actionInput: any;
  observation: string;
  timestamp: Date;
}

export interface AgentExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  averageToolsPerExecution: number;
  mostUsedTools: { toolName: string; count: number }[];
  errorRate: number;
}

export interface AgentExecutionContext {
  userId: string;
  messageText: string;
  requestId: string;
  conversationHistory: BaseMessage[];
  availableTools: string[];
  maxIterations?: number;
  timeout?: number;
}