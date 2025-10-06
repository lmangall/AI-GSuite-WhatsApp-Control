import { Tool, DynamicTool } from '@langchain/core/tools';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { ToolExecutionResult } from '../interfaces/langchain-config.interface';

export interface ILangChainToolManager {
  // Tool discovery and management
  discoverMCPTools(): Promise<LangChainTool[]>;
  createBraveSearchTool(): LangChainTool;
  getAllTools(): Promise<LangChainTool[]>;
  getMinimalTools(): Promise<LangChainTool[]>;
  
  // Tool execution
  executeTool(toolName: string, args: any): Promise<ToolExecutionResult>;
  executeToolsSequentially(toolExecutions: { toolName: string; args: any }[]): Promise<ToolExecutionResult[]>;
  
  // Tool schema management
  convertMCPToolToLangChain(mcpTool: MCPTool): MCPToolConversionResult;
  validateToolSchema(tool: LangChainTool): boolean;
  validateToolArguments(toolName: string, args: any): { valid: boolean; errors: string[] };
  
  // Tool lifecycle
  refreshTools(): Promise<void>;
  getToolByName(name: string): LangChainTool | null;
  getToolNames(): string[];
  hasToolByName(name: string): boolean;
  getToolsBySource(source: 'mcp' | 'brave' | 'internal'): LangChainTool[];
  
  // Search query utilities
  extractSearchQuery(message: string): string;
  
  // Result formatting
  formatToolResults(results: ToolExecutionResult[]): string;
  
  // Statistics and monitoring
  getToolStats(): { totalTools: number; mcpTools: number; braveTools: number; lastDiscovery?: Date };
  getExecutionHistory(limit?: number): ToolExecutionResult[];
  getExecutionStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    mostUsedTool?: string;
  };
}

export interface LangChainTool extends DynamicTool {
  source: 'mcp' | 'brave' | 'internal';
  schema: any;
  timeout?: number;
  retries?: number;
}

export interface MCPToolConversionResult {
  success: boolean;
  tool?: LangChainTool;
  error?: string;
  validationErrors?: string[];
}

export interface ToolDiscoveryResult {
  totalFound: number;
  successfulConversions: number;
  failedConversions: number;
  tools: LangChainTool[];
  errors: string[];
}

export interface ToolExecutionContext {
  toolName: string;
  arguments: Record<string, any>;
  userId?: string;
  requestId?: string;
  timeout?: number;
  retries?: number;
}