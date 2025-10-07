import { IntentDetectionResult, IntentPattern, MessageContext } from '../interfaces/langchain-config.interface';

/**
 * Interface for intent detection service
 */
export interface IIntentDetector {
  /**
   * Detects the intent of a user message
   */
  detectIntent(message: string, context?: MessageContext): Promise<IntentDetectionResult>;
  
  /**
   * Adds a new intent pattern to the detection system
   */
  addIntentPattern(intent: 'web_search' | 'mcp_tools' | 'general_chat', patterns: string[]): void;
  
  /**
   * Updates all intent patterns
   */
  updateIntentPatterns(patterns: IntentPattern[]): void;
  
  /**
   * Suggests tools based on detected intent
   */
  suggestToolsForIntent(intent: string): string[];
  
  /**
   * Extracts search query from message for web search intent
   */
  extractSearchQuery(message: string): string;
}