import { Injectable, Logger } from '@nestjs/common';
import { IntentDetectionResult, MessageContext, RoutingDecision } from '../interfaces/langchain-config.interface';
import { IntentConfigService } from './intent-config.service';

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(private intentConfigService: IntentConfigService) {}

  /**
   * Makes routing decisions based on detected intent
   */
  async routeMessage(
    detectedIntent: IntentDetectionResult, 
    message: string, 
    context?: MessageContext
  ): Promise<RoutingDecision> {
    const thresholds = this.intentConfigService.getConfidenceThresholds();
    const routingConfig = this.intentConfigService.getRoutingConfig();

    // High confidence routing
    if (detectedIntent.confidence >= thresholds.high) {
      return this.createHighConfidenceRouting(detectedIntent, message);
    }

    // Medium confidence routing with additional validation
    if (detectedIntent.confidence >= thresholds.medium) {
      return this.createMediumConfidenceRouting(detectedIntent, message, context);
    }

    // Low confidence routing with fallback consideration
    if (detectedIntent.confidence >= thresholds.low) {
      return this.createLowConfidenceRouting(detectedIntent, message, context);
    }

    // Fallback routing
    return this.createFallbackRouting(detectedIntent, message);
  }

  /**
   * Validates if web search should be triggered
   */
  shouldTriggerWebSearch(message: string, confidence: number): boolean {
    return this.intentConfigService.shouldTriggerWebSearch(message, confidence);
  }

  /**
   * Determines the best MCP tool category for a message
   */
  determineMCPCategory(message: string): string {
    return this.intentConfigService.determineMCPToolCategory(message);
  }

  /**
   * Creates routing decision for high confidence intents
   */
  private createHighConfidenceRouting(
    detectedIntent: IntentDetectionResult, 
    message: string
  ): RoutingDecision {
    const decision: RoutingDecision = {
      intent: detectedIntent.intent,
      confidence: detectedIntent.confidence,
      toolsToUse: detectedIntent.suggestedTools || [],
      shouldFallback: false,
      routingReason: `High confidence ${detectedIntent.intent} intent detected`
    };

    if (detectedIntent.intent === 'web_search') {
      decision.searchQuery = detectedIntent.searchQuery || this.intentConfigService.optimizeSearchQuery(message);
      decision.toolsToUse = this.intentConfigService.getToolsForIntent('web_search');
    } else if (detectedIntent.intent === 'mcp_tools') {
      decision.mcpCategory = this.intentConfigService.determineMCPToolCategory(message);
      decision.toolsToUse = this.intentConfigService.getToolsForIntent('mcp_tools', decision.mcpCategory);
    }

    this.logger.debug(`High confidence routing: ${decision.intent} (${decision.confidence})`);
    return decision;
  }

  /**
   * Creates routing decision for medium confidence intents with validation
   */
  private createMediumConfidenceRouting(
    detectedIntent: IntentDetectionResult, 
    message: string, 
    context?: MessageContext
  ): RoutingDecision {
    // For web search, validate if it really needs real-time information
    if (detectedIntent.intent === 'web_search') {
      const shouldSearch = this.shouldTriggerWebSearch(message, detectedIntent.confidence);
      
      if (shouldSearch) {
        return {
          intent: 'web_search',
          confidence: detectedIntent.confidence,
          toolsToUse: this.intentConfigService.getToolsForIntent('web_search'),
          searchQuery: this.intentConfigService.optimizeSearchQuery(message),
          shouldFallback: false,
          routingReason: 'Medium confidence web search with validation passed'
        };
      } else {
        // Fallback to general chat if web search validation fails
        return {
          intent: 'general_chat',
          confidence: 0.6,
          toolsToUse: [],
          shouldFallback: true,
          routingReason: 'Web search validation failed, falling back to general chat'
        };
      }
    }

    // For MCP tools, validate if we have appropriate tools available
    if (detectedIntent.intent === 'mcp_tools') {
      const mcpCategory = this.intentConfigService.determineMCPToolCategory(message);
      const availableTools = this.intentConfigService.getToolsForIntent('mcp_tools', mcpCategory);
      
      if (availableTools.length > 0) {
        return {
          intent: 'mcp_tools',
          confidence: detectedIntent.confidence,
          toolsToUse: availableTools,
          mcpCategory,
          shouldFallback: false,
          routingReason: `Medium confidence MCP tools routing to ${mcpCategory} category`
        };
      } else {
        // Fallback to general chat if no appropriate tools
        return {
          intent: 'general_chat',
          confidence: 0.6,
          toolsToUse: [],
          shouldFallback: true,
          routingReason: 'No appropriate MCP tools available, falling back to general chat'
        };
      }
    }

    // General chat with medium confidence
    return {
      intent: 'general_chat',
      confidence: detectedIntent.confidence,
      toolsToUse: [],
      shouldFallback: false,
      routingReason: 'Medium confidence general chat intent'
    };
  }

  /**
   * Creates routing decision for low confidence intents
   */
  private createLowConfidenceRouting(
    detectedIntent: IntentDetectionResult, 
    message: string, 
    context?: MessageContext
  ): RoutingDecision {
    // For low confidence, be more conservative and prefer general chat
    // unless there are strong indicators for specific intents

    // Check for strong web search indicators
    if (this.shouldTriggerWebSearch(message, detectedIntent.confidence)) {
      return {
        intent: 'web_search',
        confidence: Math.max(detectedIntent.confidence, 0.7), // Boost confidence due to strong indicators
        toolsToUse: this.intentConfigService.getToolsForIntent('web_search'),
        searchQuery: this.intentConfigService.optimizeSearchQuery(message),
        shouldFallback: false,
        routingReason: 'Low confidence but strong web search indicators detected'
      };
    }

    // Check for explicit action words that suggest MCP tools
    const actionWords = /\b(send|create|add|schedule|remind|save|write|compose|book|arrange)\b/i;
    if (actionWords.test(message) && detectedIntent.intent === 'mcp_tools') {
      const mcpCategory = this.intentConfigService.determineMCPToolCategory(message);
      return {
        intent: 'mcp_tools',
        confidence: Math.max(detectedIntent.confidence, 0.6),
        toolsToUse: this.intentConfigService.getToolsForIntent('mcp_tools', mcpCategory),
        mcpCategory,
        shouldFallback: false,
        routingReason: 'Low confidence but explicit action words detected for MCP tools'
      };
    }

    // Default to general chat for low confidence
    return {
      intent: 'general_chat',
      confidence: 0.7, // Higher confidence for general chat as it's the safest option
      toolsToUse: [],
      shouldFallback: false,
      routingReason: 'Low confidence intent, defaulting to general chat for safety'
    };
  }

  /**
   * Creates fallback routing decision
   */
  private createFallbackRouting(
    detectedIntent: IntentDetectionResult, 
    message: string
  ): RoutingDecision {
    const defaultIntent = this.intentConfigService.getDefaultIntent();
    
    return {
      intent: defaultIntent,
      confidence: 0.5,
      toolsToUse: this.intentConfigService.getToolsForIntent(defaultIntent),
      shouldFallback: true,
      routingReason: `Intent confidence below threshold, using default intent: ${defaultIntent}`
    };
  }

  /**
   * Gets routing statistics for monitoring
   */
  getRoutingStats(): {
    totalRoutes: number;
    intentDistribution: Record<string, number>;
    averageConfidence: number;
    fallbackRate: number;
  } {
    // In a real implementation, this would track routing statistics
    return {
      totalRoutes: 0,
      intentDistribution: {
        web_search: 0,
        mcp_tools: 0,
        general_chat: 0
      },
      averageConfidence: 0,
      fallbackRate: 0
    };
  }

  /**
   * Validates routing configuration
   */
  validateRoutingConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const routingConfig = this.intentConfigService.getRoutingConfig();

    // Validate web search configuration
    if (!routingConfig.web_search.primaryTool) {
      errors.push('Web search primary tool not configured');
    }

    // Validate MCP tools configuration
    if (!routingConfig.mcp_tools.discoveryRequired !== undefined) {
      errors.push('MCP tools discovery configuration missing');
    }

    // Validate timeouts
    if (routingConfig.web_search.timeout <= 0) {
      errors.push('Web search timeout must be greater than 0');
    }

    if (routingConfig.mcp_tools.timeout <= 0) {
      errors.push('MCP tools timeout must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}