import { PromptTemplate, ChatPromptTemplate } from '@langchain/core/prompts';
import { MessageContext } from '../interfaces/langchain-config.interface';

export interface ILangChainPromptManager {
  // Prompt templates
  getSystemPrompt(): PromptTemplate;
  getUserPrompt(context: string): PromptTemplate;
  getToolPrompt(toolName: string): PromptTemplate;
  getChatPrompt(): ChatPromptTemplate;
  
  // Dynamic prompt selection
  selectPromptStrategy(messageContext: MessageContext): ChatPromptTemplate;
  
  // Prompt configuration
  updatePromptTemplate(name: string, template: string): void;
  loadPromptsFromConfig(): Promise<void>;
  
  // Context-aware prompts
  buildContextualPrompt(messageContext: MessageContext): Promise<ChatPromptTemplate>;
  formatPromptWithContext(template: PromptTemplate, context: Record<string, any>): Promise<string>;
  createContextAwarePrompt(messageContext: MessageContext, userPreferences?: Record<string, any>): Promise<ChatPromptTemplate>;
  generateDynamicPrompt(availableTools: string[], messageContext: MessageContext): Promise<ChatPromptTemplate>;
  createMemoryAwarePrompt(messageContext: MessageContext, memoryContext: string): Promise<ChatPromptTemplate>;
  
  // Output parsing strategies
  createOutputParsingStrategy(intent: string): {
    shouldStructure: boolean;
    format: 'json' | 'markdown' | 'plain' | 'whatsapp';
    instructions: string;
  };
  
  // Error handling prompts
  createErrorHandlingPrompt(error: string, originalMessage: string): ChatPromptTemplate;
  createFallbackPrompt(failedTools: string[], originalMessage: string): ChatPromptTemplate;
  
  // Validation and utilities
  validatePromptContext(context: Record<string, any>, requiredVariables: string[]): {
    isComplete: boolean;
    missingVariables: string[];
  };
  
  // Management
  getPromptTemplateNames(): string[];
  getPromptTemplateByName(name: string): PromptTemplate | null;
  getPromptStats(): {
    totalTemplates: number;
    totalStrategies: number;
    mostUsedStrategy?: string;
  };
}

export interface PromptTemplateConfig {
  name: string;
  template: string;
  variables: string[];
  description?: string;
  category: 'system' | 'user' | 'tool' | 'chat' | 'context';
}

export interface PromptStrategy {
  name: string;
  intent: 'web_search' | 'mcp_tools' | 'general_chat';
  systemPrompt: string;
  userPromptTemplate: string;
  contextInstructions: string;
  outputFormat: string;
}

export interface PromptContext {
  userId: string;
  conversationHistory: string;
  detectedIntent: string;
  availableTools: string[];
  currentTime: string;
  userPreferences?: Record<string, any>;
}

export interface PromptValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingVariables: string[];
}