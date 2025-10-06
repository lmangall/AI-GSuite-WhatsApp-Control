import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntentPattern } from '../interfaces/langchain-config.interface';
import {
  DEFAULT_INTENT_PATTERNS,
  INTENT_CONFIDENCE_THRESHOLDS,
  INTENT_TOOL_MAPPING,
  SEARCH_QUERY_PATTERNS
} from './intent-patterns.config';

@Injectable()
export class IntentConfigService {
  private readonly logger = new Logger(IntentConfigService.name);
  private intentPatterns: IntentPattern[] = [];
  private confidenceThresholds = INTENT_CONFIDENCE_THRESHOLDS;

  constructor(private configService: ConfigService) {
    this.loadIntentConfiguration();
  }

  /**
   * Gets all configured intent patterns
   */
  getIntentPatterns(): IntentPattern[] {
    return [...this.intentPatterns];
  }

  /**
   * Gets confidence thresholds for intent detection
   */
  getConfidenceThresholds() {
    return {
      high: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_HIGH_CONFIDENCE', String(this.confidenceThresholds.HIGH_CONFIDENCE))),
      medium: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_MEDIUM_CONFIDENCE', String(this.confidenceThresholds.MEDIUM_CONFIDENCE))),
      low: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_LOW_CONFIDENCE', String(this.confidenceThresholds.LOW_CONFIDENCE))),
      fallback: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_FALLBACK_THRESHOLD', String(this.confidenceThresholds.FALLBACK_THRESHOLD)))
    };
  }

  /**
   * Gets the default intent when confidence is below threshold
   */
  getDefaultIntent(): 'web_search' | 'mcp_tools' | 'general_chat' | 'greeting' {
    return this.configService.get<'web_search' | 'mcp_tools' | 'general_chat' | 'greeting'>(
      'LANGCHAIN_DEFAULT_INTENT',
      'general_chat'
    );
  }

  /**
   * Gets tool suggestions for a specific intent
   */
  getToolsForIntent(intent: 'web_search' | 'mcp_tools' | 'general_chat' | 'greeting', subCategory?: string): string[] {
    if (intent === 'web_search') {
      return INTENT_TOOL_MAPPING.web_search;
    }

    if (intent === 'mcp_tools') {
      if (subCategory && INTENT_TOOL_MAPPING.mcp_tools[subCategory]) {
        return INTENT_TOOL_MAPPING.mcp_tools[subCategory];
      }
      return INTENT_TOOL_MAPPING.mcp_tools.general;
    }

    if (intent === 'greeting') {
      return INTENT_TOOL_MAPPING.greeting;
    }

    return INTENT_TOOL_MAPPING.general_chat;
  }

  /**
   * Gets web search keywords configuration
   */
  getWebSearchKeywords(): string[] {
    const webSearchPattern = this.intentPatterns.find(p => p.intent === 'web_search');
    return webSearchPattern ? webSearchPattern.keywords : [];
  }

  /**
   * Gets MCP tool keywords configuration
   */
  getMCPToolKeywords(): string[] {
    const mcpPattern = this.intentPatterns.find(p => p.intent === 'mcp_tools');
    return mcpPattern ? mcpPattern.keywords : [];
  }

  /**
   * Optimizes search query based on detected patterns
   */
  optimizeSearchQuery(query: string, detectedCategory?: string): string {
    let optimizedQuery = query.trim();

    // Remove common search prefixes
    for (const pattern of SEARCH_QUERY_PATTERNS.REMOVE_PATTERNS) {
      optimizedQuery = optimizedQuery.replace(pattern, '').trim();
    }

    // Apply category-specific enhancements
    if (detectedCategory && SEARCH_QUERY_PATTERNS.ENHANCE_PATTERNS[detectedCategory]) {
      const enhancer = SEARCH_QUERY_PATTERNS.ENHANCE_PATTERNS[detectedCategory];
      optimizedQuery = enhancer(optimizedQuery);
    }

    return optimizedQuery || query; // Fallback to original if optimization results in empty string
  }

  /**
   * Determines if web search should be triggered based on message content
   */
  shouldTriggerWebSearch(message: string, confidence: number): boolean {
    const thresholds = this.getConfidenceThresholds();

    // High confidence web search intent
    if (confidence >= thresholds.high) {
      return true;
    }

    // Check for explicit web search indicators
    const webSearchIndicators = [
      /\b(latest|current|recent|today|now|breaking)\b/i,
      /\b(weather|temperature|forecast)\b/i,
      /\b(stock|price|market|crypto)\b/i,
      /\b(news|update|trending)\b/i,
      /\b(search|google|find|look up)\b/i
    ];

    return webSearchIndicators.some(pattern => pattern.test(message));
  }

  /**
   * Determines MCP tool category based on message content
   */
  determineMCPToolCategory(message: string): string {
    const normalizedMessage = message.toLowerCase();

    // Email category
    if (/\b(email|mail|send|message|compose|reply|forward)\b/.test(normalizedMessage)) {
      return 'email';
    }

    // Calendar category
    if (/\b(calendar|schedule|appointment|meeting|event|remind)\b/.test(normalizedMessage)) {
      return 'calendar';
    }

    // Tasks category
    if (/\b(task|todo|create|add|assign|complete|project)\b/.test(normalizedMessage)) {
      return 'tasks';
    }

    // Notes category
    if (/\b(note|notes|write|save|record|document|memo)\b/.test(normalizedMessage)) {
      return 'notes';
    }

    // Files category
    if (/\b(file|document|upload|download|share|save)\b/.test(normalizedMessage)) {
      return 'files';
    }

    return 'general';
  }

  /**
   * Gets routing configuration for different intents
   */
  getRoutingConfig() {
    return {
      web_search: {
        primaryTool: 'brave_search',
        fallbackBehavior: 'general_chat',
        requiresQuery: true,
        timeout: parseInt(this.configService.get<string>('BRAVE_SEARCH_TIMEOUT', '10000'), 10)
      },
      mcp_tools: {
        discoveryRequired: true,
        fallbackBehavior: 'general_chat',
        timeout: parseInt(this.configService.get<string>('MCP_TOOL_TIMEOUT', '30000'), 10),
        maxRetries: parseInt(this.configService.get<string>('MCP_TOOL_MAX_RETRIES', '2'), 10)
      },
      general_chat: {
        useMemory: true,
        contextWindow: parseInt(this.configService.get<string>('LANGCHAIN_MAX_TOKENS', '4000'), 10),
        fallbackBehavior: 'error_response'
      }
    };
  }

  /**
   * Validates intent configuration
   */
  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate intent patterns
    if (this.intentPatterns.length === 0) {
      errors.push('No intent patterns configured');
    }

    // Validate required intents exist
    const requiredIntents = ['web_search', 'mcp_tools', 'general_chat'];
    const configuredIntents = this.intentPatterns.map(p => p.intent);

    for (const intent of requiredIntents) {
      if (!configuredIntents.includes(intent as any)) {
        errors.push(`Missing required intent pattern: ${intent}`);
      }
    }

    // Validate confidence thresholds
    const thresholds = this.getConfidenceThresholds();
    if (thresholds.high <= thresholds.medium || thresholds.medium <= thresholds.low) {
      errors.push('Confidence thresholds must be in descending order (high > medium > low)');
    }

    // Validate tool mappings
    if (!INTENT_TOOL_MAPPING.web_search || INTENT_TOOL_MAPPING.web_search.length === 0) {
      errors.push('Web search tools not configured');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Reloads intent configuration from environment/config
   */
  reloadConfiguration(): void {
    this.loadIntentConfiguration();
    this.logger.log('Intent configuration reloaded');
  }

  /**
   * Loads intent configuration from various sources
   */
  private loadIntentConfiguration(): void {
    // Start with default patterns
    this.intentPatterns = [...DEFAULT_INTENT_PATTERNS];

    // Load custom patterns from environment if available
    const customPatternsPath = this.configService.get<string>('LANGCHAIN_INTENT_PATTERNS_PATH');
    if (customPatternsPath) {
      try {
        // In a real implementation, you would load from file system
        this.logger.debug(`Custom intent patterns path configured: ${customPatternsPath}`);
      } catch (error) {
        this.logger.warn(`Failed to load custom intent patterns: ${error.message}`);
      }
    }

    // Load confidence thresholds from environment
    this.confidenceThresholds = {
      HIGH_CONFIDENCE: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_HIGH_CONFIDENCE', String(INTENT_CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE))),
      MEDIUM_CONFIDENCE: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_MEDIUM_CONFIDENCE', String(INTENT_CONFIDENCE_THRESHOLDS.MEDIUM_CONFIDENCE))),
      LOW_CONFIDENCE: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_LOW_CONFIDENCE', String(INTENT_CONFIDENCE_THRESHOLDS.LOW_CONFIDENCE))),
      FALLBACK_THRESHOLD: parseFloat(this.configService.get<string>('LANGCHAIN_INTENT_FALLBACK_THRESHOLD', String(INTENT_CONFIDENCE_THRESHOLDS.FALLBACK_THRESHOLD)))
    };

    this.logger.debug(`Loaded ${this.intentPatterns.length} intent patterns`);
  }
}