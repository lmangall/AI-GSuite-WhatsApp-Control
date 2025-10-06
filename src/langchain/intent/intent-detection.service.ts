import { Injectable, Logger } from '@nestjs/common';
import { IntentDetectionResult, IntentPattern, MessageContext } from '../interfaces/langchain-config.interface';
import { IntentConfigService } from './intent-config.service';

@Injectable()
export class IntentDetectionService {
  private readonly logger = new Logger(IntentDetectionService.name);

  constructor(private intentConfigService: IntentConfigService) {}

  /**
   * Detects the intent of a user message using keyword and pattern matching
   */
  async detectIntent(message: string, context?: MessageContext): Promise<IntentDetectionResult> {
    const normalizedMessage = message.toLowerCase().trim();
    const intentPatterns = this.intentConfigService.getIntentPatterns();
    const thresholds = this.intentConfigService.getConfidenceThresholds();
    
    // Score each intent pattern
    const intentScores = intentPatterns.map(pattern => ({
      pattern,
      score: this.calculateIntentScore(normalizedMessage, pattern)
    }));

    // Sort by score (highest first) and priority
    intentScores.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.pattern.priority - a.pattern.priority;
    });

    const bestMatch = intentScores[0];
    
    // If no pattern matches with sufficient confidence, use default intent
    if (bestMatch.score < thresholds.fallback) {
      const defaultIntent = this.intentConfigService.getDefaultIntent();
      return {
        intent: defaultIntent,
        confidence: 0.5,
      };
    }

    const result: IntentDetectionResult = {
      intent: bestMatch.pattern.intent,
      confidence: Math.min(bestMatch.score, 1.0),
    };

    // Add intent-specific data
    if (bestMatch.pattern.intent === 'web_search') {
      result.searchQuery = this.intentConfigService.optimizeSearchQuery(message);
      result.suggestedTools = this.intentConfigService.getToolsForIntent('web_search');
    } else if (bestMatch.pattern.intent === 'mcp_tools') {
      const mcpCategory = this.intentConfigService.determineMCPToolCategory(message);
      result.suggestedTools = this.intentConfigService.getToolsForIntent('mcp_tools', mcpCategory);
    }

    this.logger.debug(`Intent detected: ${result.intent} (confidence: ${result.confidence})`);
    
    return result;
  }

  /**
   * Adds a new intent pattern to the detection system
   */
  addIntentPattern(intent: 'web_search' | 'mcp_tools' | 'general_chat', patterns: string[]): void {
    // This method now delegates to the configuration service
    this.logger.debug(`Intent pattern addition requested for ${intent}: ${patterns.join(', ')}`);
    // In a full implementation, this would update the configuration service
    this.logger.warn('Dynamic pattern addition not yet implemented - use configuration service');
  }

  /**
   * Updates all intent patterns
   */
  updateIntentPatterns(patterns: IntentPattern[]): void {
    // This method now delegates to the configuration service
    this.logger.debug(`Intent pattern update requested: ${patterns.length} patterns`);
    // In a full implementation, this would update the configuration service
    this.logger.warn('Dynamic pattern updates not yet implemented - use configuration service');
  }

  /**
   * Suggests MCP tools based on detected intent
   */
  suggestToolsForIntent(intent: string): string[] {
    if (intent === 'web_search') {
      return this.intentConfigService.getToolsForIntent('web_search');
    } else if (intent === 'mcp_tools') {
      return this.intentConfigService.getToolsForIntent('mcp_tools');
    }
    return [];
  }

  /**
   * Extracts search query from message for web search intent
   */
  extractSearchQuery(message: string): string {
    return this.intentConfigService.optimizeSearchQuery(message);
  }

  /**
   * Calculates confidence score for an intent pattern
   */
  private calculateIntentScore(message: string, pattern: IntentPattern): number {
    let score = 0;
    const words = message.split(/\s+/);
    const totalWords = words.length;

    // Keyword matching
    let keywordMatches = 0;
    for (const keyword of pattern.keywords) {
      if (message.includes(keyword.toLowerCase())) {
        keywordMatches++;
        score += 0.3;
      }
    }

    // Pattern matching (regex)
    let patternMatches = 0;
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        patternMatches++;
        score += 0.4;
      }
    }

    // Boost score based on keyword density
    if (keywordMatches > 0) {
      const keywordDensity = keywordMatches / Math.max(totalWords, 1);
      score += keywordDensity * 0.2;
    }

    // Apply priority multiplier
    score *= (pattern.priority / 3);

    return Math.min(score, 1.0);
  }


}