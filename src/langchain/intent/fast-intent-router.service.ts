import { Injectable, Logger } from '@nestjs/common';
import { GreetingResponseService } from '../responses/greeting-response.service';

export interface FastRouteResult {
  shouldUseFastPath: boolean;
  response?: string;
  intent?: 'greeting' | 'capability' | 'thanks' | 'complex';
}

@Injectable()
export class FastIntentRouterService {
  private readonly logger = new Logger(FastIntentRouterService.name);

  constructor(private greetingService: GreetingResponseService) {}

  /**
   * Quickly determine if a message can be handled with a fast response
   */
  async routeMessage(message: string, userId: string, conversationHistory?: any[]): Promise<FastRouteResult> {
    const normalizedMessage = message.toLowerCase().trim();
    
    // Check for simple greetings
    if (this.greetingService.isSimpleGreeting(message)) {
      this.logger.debug(`⚡ Fast route: Simple greeting detected for "${message}"`);
      
      const shouldShowFull = this.greetingService.shouldShowFullGreeting(message, conversationHistory);
      const response = shouldShowFull 
        ? this.greetingService.generateGreetingResponse(message)
        : this.greetingService.generateQuickGreeting(message);
      
      return {
        shouldUseFastPath: true,
        response,
        intent: 'greeting'
      };
    }
    
    // Check for capability questions
    const capabilityPatterns = [
      /what can you do/i,
      /what do you do/i,
      /help me/i,
      /what are your capabilities/i,
      /what features/i,
      /how can you help/i,
      /what can i ask/i,
      /what are you/i
    ];
    
    if (capabilityPatterns.some(pattern => pattern.test(message))) {
      this.logger.debug(`⚡ Fast route: Capability question detected for "${message}"`);
      
      const response = this.greetingService.generateGreetingResponse(message);
      return {
        shouldUseFastPath: true,
        response,
        intent: 'capability'
      };
    }
    
    // Check for simple thank you messages
    const thankYouPatterns = [
      /^thanks?!?$/i,
      /^thank you!?$/i,
      /^ty!?$/i,
      /^thx!?$/i,
      /^appreciate it!?$/i,
      /^much appreciated!?$/i
    ];
    
    if (thankYouPatterns.some(pattern => pattern.test(normalizedMessage))) {
      this.logger.debug(`⚡ Fast route: Thank you message detected for "${message}"`);
      
      const responses = [
        "You're welcome! 😊",
        "Happy to help! 🤖",
        "Anytime! 👍",
        "No problem! ⚡",
        "Glad I could help! 🚀",
        "My pleasure! 💪"
      ];
      
      const response = responses[Math.floor(Math.random() * responses.length)];
      return {
        shouldUseFastPath: true,
        response,
        intent: 'thanks'
      };
    }
    
    // Check for simple affirmations
    const affirmationPatterns = [
      /^(ok|okay|alright|cool|nice|great|awesome|perfect)!?$/i,
      /^got it!?$/i,
      /^understood!?$/i,
      /^sounds good!?$/i
    ];
    
    if (affirmationPatterns.some(pattern => pattern.test(normalizedMessage))) {
      this.logger.debug(`⚡ Fast route: Affirmation detected for "${message}"`);
      
      const responses = [
        "👍",
        "Great! 😊",
        "Perfect! ⚡",
        "Awesome! 🚀",
        "Cool! 😎"
      ];
      
      const response = responses[Math.floor(Math.random() * responses.length)];
      return {
        shouldUseFastPath: true,
        response,
        intent: 'thanks'
      };
    }
    
    // Check for simple email requests that need tools but can be handled quickly
    const emailPatterns = [
      /^check.*email/i,
      /^show.*email/i,
      /^get.*email/i,
      /^my.*email/i,
      /^email/i,
      /^unread/i,
      /^inbox/i
    ];
    
    if (emailPatterns.some(pattern => pattern.test(normalizedMessage))) {
      this.logger.debug(`📧 Fast route: Email request detected for "${message}" - will use optimized agent flow`);
      return {
        shouldUseFastPath: false, // Still needs agent but with email optimization
        intent: 'complex'
      };
    }

    // Check for simple status/confirmation requests
    const statusPatterns = [
      /^(yes|yep|yeah|sure|do it|go ahead|proceed)!?$/i,
      /^(no|nope|cancel|stop|don't)!?$/i
    ];
    
    if (statusPatterns.some(pattern => pattern.test(normalizedMessage))) {
      this.logger.debug(`⚡ Fast route: Status confirmation detected for "${message}"`);
      
      const isPositive = /^(yes|yep|yeah|sure|do it|go ahead|proceed)!?$/i.test(normalizedMessage);
      const response = isPositive 
        ? "Got it! 👍" 
        : "No problem! 👌";
      
      return {
        shouldUseFastPath: true,
        response,
        intent: 'thanks'
      };
    }

    // No fast path available - needs complex processing
    this.logger.debug(`🔄 Complex route: Message "${message}" requires full agent processing`);
    return {
      shouldUseFastPath: false,
      intent: 'complex'
    };
  }

  /**
   * Check if a message is likely to need web search
   */
  isWebSearchQuery(message: string): boolean {
    const webSearchKeywords = [
      'latest', 'news', 'current', 'today', 'recent', 'now',
      'weather', 'temperature', 'forecast',
      'stock', 'price', 'market', 'trading',
      'breaking', 'update', 'happening',
      'score', 'result', 'match', 'game',
      'search', 'find', 'lookup', 'google'
    ];
    
    const lowerMessage = message.toLowerCase();
    return webSearchKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Check if a message is likely to need MCP tools
   */
  isMCPToolsQuery(message: string): boolean {
    const mcpKeywords = [
      'send email', 'email', 'schedule', 'calendar',
      'create', 'add', 'save', 'write',
      'reminder', 'remind', 'note', 'task'
    ];
    
    const lowerMessage = message.toLowerCase();
    return mcpKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Get routing statistics for monitoring
   */
  getRoutingStats(): {
    totalRoutes: number;
    fastPathRoutes: number;
    complexRoutes: number;
    intentDistribution: Record<string, number>;
  } {
    // In a real implementation, this would track actual statistics
    return {
      totalRoutes: 0,
      fastPathRoutes: 0,
      complexRoutes: 0,
      intentDistribution: {
        greeting: 0,
        capability: 0,
        thanks: 0,
        complex: 0
      }
    };
  }
}