export interface LangChainConfig {
  // Model configuration (Gemini primary, OpenAI fallback)
  defaultModel: 'gemini' | 'openai';
  fallbackModel: 'gemini' | 'openai';
  
  // Memory configuration
  memoryType: 'buffer' | 'summary' | 'conversation';
  maxTokens: number;
  memoryExpiryHours: number;
  
  // Tool configuration
  enabledTools: string[];
  toolTimeout: number;
  maxToolCalls: number;
  
  // Prompt configuration
  systemPromptPath?: string;
  promptTemplatesPath?: string;
  
  // Performance configuration
  enableTracing: boolean;
  enableMetrics: boolean;
  cacheEnabled: boolean;
}

export interface MessageContext {
  userId: string;
  messageText: string;
  conversationHistory: ConversationMessage[];
  detectedIntent?: IntentDetectionResult;
  timestamp: Date;
  requestId?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface IntentDetectionResult {
  intent: 'web_search' | 'mcp_tools' | 'general_chat' | 'greeting';
  confidence: number;
  suggestedTools?: string[];
  searchQuery?: string;
}

export interface IntentPattern {
  intent: 'web_search' | 'mcp_tools' | 'general_chat' | 'greeting';
  keywords: string[];
  patterns: RegExp[];
  priority: number;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: Date;
}

// Intent routing interfaces
export interface RoutingDecision {
  intent: 'web_search' | 'mcp_tools' | 'general_chat';
  confidence: number;
  toolsToUse: string[];
  searchQuery?: string;
  mcpCategory?: string;
  shouldFallback: boolean;
  routingReason: string;
}

export interface IntentConfidenceThresholds {
  high: number;
  medium: number;
  low: number;
  fallback: number;
}

export interface RoutingConfig {
  web_search: {
    primaryTool: string;
    fallbackBehavior: string;
    requiresQuery: boolean;
    timeout: number;
  };
  mcp_tools: {
    discoveryRequired: boolean;
    fallbackBehavior: string;
    timeout: number;
    maxRetries: number;
  };
  general_chat: {
    useMemory: boolean;
    contextWindow: number;
    fallbackBehavior: string;
  };
}