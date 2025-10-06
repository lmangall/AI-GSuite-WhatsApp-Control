import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { pull } from 'langchain/hub';

import { IAgentService } from '../../agent/agent.interface';
import { BaseAgentService } from '../../agent/base-agent.service';
import { LangChainConfigService } from '../config/langchain-config.service';
import { LangChainToolManagerService } from '../tools/tool-manager.service';
import { LangChainConfig, MessageContext, ConversationMessage } from '../interfaces/langchain-config.interface';

interface LangChainConversationMessage extends ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

@Injectable()
export class LangChainAgentService extends BaseAgentService<LangChainConversationMessage> implements IAgentService, OnModuleInit {
  protected readonly logger = new Logger(LangChainAgentService.name);
  
  private config: LangChainConfig;
  private primaryModel: ChatGoogleGenerativeAI | ChatOpenAI | null = null;
  private fallbackModel: ChatGoogleGenerativeAI | ChatOpenAI | null = null;
  private agentExecutor: AgentExecutor | null = null;
  private isInitialized = false;

  constructor(
    configService: ConfigService,
    private langChainConfigService: LangChainConfigService,
    private toolManager: LangChainToolManagerService,
  ) {
    super(configService);
    this.config = this.langChainConfigService.getLangChainConfig();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.initializeAgent();
      this.startCleanupInterval();
      this.logger.log('🚀 LangChain Agent Service initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize LangChain Agent Service', error);
      throw error;
    }
  }

  async initializeAgent(): Promise<void> {
    try {
      // Validate configuration first
      const validation = this.langChainConfigService.validateConfiguration();
      if (!validation.isValid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      // Initialize models
      this.primaryModel = this.createModel(this.config.defaultModel);
      this.fallbackModel = this.createModel(this.config.fallbackModel);

      // Create agent executor with basic setup
      this.agentExecutor = await this.createAgentExecutor(this.config.defaultModel);
      
      this.isInitialized = true;
      this.logger.log(`✅ LangChain agent initialized with ${this.config.defaultModel} as primary model`);
    } catch (error) {
      this.logger.error('❌ Failed to initialize LangChain agent', error);
      throw error;
    }
  }

  async createAgentExecutor(modelType: 'gemini' | 'openai'): Promise<AgentExecutor> {
    try {
      const model = this.createModel(modelType);
      
      // Load tools from tool manager
      const tools: Tool[] = await this.loadToolsSafely();
      
      this.logger.log(`🔧 Creating agent executor with ${tools.length} tools for ${modelType} model`);

      // Use the standard ReAct prompt from LangChain hub
      const prompt = await pull<ChatPromptTemplate>("hwchase17/react-chat");

      // Create the agent
      const agent = await createReactAgent({
        llm: model,
        tools,
        prompt,
      });

      // Create and return the agent executor
      const executor = new AgentExecutor({
        agent,
        tools,
        verbose: this.config.enableTracing,
        maxIterations: this.config.maxToolCalls,
        returnIntermediateSteps: true,
      });
      
      this.logger.log(`✅ Agent executor created successfully`);
      this.logger.log(`   - Model: ${modelType}`);
      this.logger.log(`   - Tools: ${tools.length} available`);
      this.logger.log(`   - Max iterations: ${this.config.maxToolCalls}`);
      this.logger.log(`   - Verbose: ${this.config.enableTracing}`);
      this.logger.log(`   - Tool names: ${tools.map(t => t.name).join(', ')}`);
      
      return executor;
    } catch (error) {
      this.logger.error(`❌ Failed to create agent executor for ${modelType}`, error);
      throw error;
    }
  }

  private createModel(modelType: 'gemini' | 'openai'): ChatGoogleGenerativeAI | ChatOpenAI {
    try {
      if (modelType === 'gemini') {
        const apiKey = this.langChainConfigService.getGeminiApiKey();
        if (!apiKey) {
          throw new Error('Gemini API key not configured');
        }
        
        return new ChatGoogleGenerativeAI({
          apiKey,
          model: 'gemini-2.5-flash',
          temperature: 0.7,
          maxOutputTokens: this.config.maxTokens,
        });
      } else {
        const apiKey = this.langChainConfigService.getOpenAIApiKey();
        if (!apiKey) {
          throw new Error('OpenAI API key not configured');
        }
        
        return new ChatOpenAI({
          apiKey,
          modelName: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: this.config.maxTokens,
        });
      }
    } catch (error) {
      this.logger.error(`❌ Failed to create ${modelType} model`, error);
      throw error;
    }
  }

  getPrimaryModel(): ChatGoogleGenerativeAI | ChatOpenAI {
    if (!this.primaryModel) {
      throw new Error('Primary model not initialized');
    }
    return this.primaryModel;
  }

  getFallbackModel(): ChatGoogleGenerativeAI | ChatOpenAI {
    if (!this.fallbackModel) {
      throw new Error('Fallback model not initialized');
    }
    return this.fallbackModel;
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    if (!this.isInitialized || !this.agentExecutor) {
      throw new Error('LangChain agent not initialized');
    }

    const startTime = Date.now();
    
    try {
      this.logger.log(`🔄 [${requestId}] Processing message for user ${userId} with ${this.config.defaultModel} model`);
      this.logger.log(`📝 [${requestId}] Message: "${userMessage}"`);

      // Get conversation history
      const history = this.getUserHistory(userId);
      const chatHistory = this.convertToLangChainMessages(history);
      
      this.logger.debug(`💭 [${requestId}] Chat history: ${chatHistory.length} messages`);

      // Log available tools before execution
      const availableTools = await this.getAvailableTools();
      this.logger.log(`🛠️  [${requestId}] Available tools: ${availableTools.length} (${availableTools.map(t => t.name).join(', ')})`);

      // Execute the agent with primary model
      this.logger.debug(`🚀 [${requestId}] Invoking agent executor...`);
      const result = await this.executeWithModel(this.agentExecutor, userMessage, chatHistory, this.config.defaultModel);
      
      // Log intermediate steps if available
      if (result.intermediateSteps && result.intermediateSteps.length > 0) {
        this.logger.log(`🔧 [${requestId}] Agent used ${result.intermediateSteps.length} tool call(s)`);
        result.intermediateSteps.forEach((step: any, index: number) => {
          const toolName = step.action?.tool || 'unknown';
          const toolInput = JSON.stringify(step.action?.toolInput || {}).substring(0, 100);
          this.logger.log(`   ${index + 1}. Tool: ${toolName}, Input: ${toolInput}`);
        });
      } else {
        this.logger.warn(`⚠️  [${requestId}] No tools were called by the agent`);
      }

      // Add messages to history
      this.addToHistory(userId, {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      });

      this.addToHistory(userId, {
        role: 'assistant',
        content: result.output,
        timestamp: new Date(),
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ [${requestId}] Successfully processed message for user ${userId} with ${this.config.defaultModel} model (${duration}ms)`);
      this.logger.log(`📤 [${requestId}] Response: "${result.output.substring(0, 150)}${result.output.length > 150 ? '...' : ''}"`);
      
      return result.output;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ [${requestId}] Primary model (${this.config.defaultModel}) failed for user ${userId} after ${duration}ms:`, error);
      
      // Try fallback model if primary fails and they're different
      if (this.config.defaultModel !== this.config.fallbackModel) {
        return await this.processMessageWithFallback(userId, userMessage, requestId, startTime);
      }
      
      throw new Error(`Primary model (${this.config.defaultModel}) failed: ${error.message}`);
    }
  }

  private async processMessageWithFallback(userId: string, userMessage: string, requestId: string, originalStartTime: number): Promise<string> {
    const fallbackStartTime = Date.now();
    
    try {
      this.logger.warn(`🔄 Switching to fallback model (${this.config.fallbackModel}) for user ${userId} (${requestId})`);
      
      // Create a temporary agent executor with fallback model
      const fallbackExecutor = await this.createAgentExecutor(this.config.fallbackModel);
      
      // Get conversation history
      const history = this.getUserHistory(userId);
      const chatHistory = this.convertToLangChainMessages(history);

      // Execute with fallback model
      const result = await this.executeWithModel(fallbackExecutor, userMessage, chatHistory, this.config.fallbackModel);

      // Add messages to history
      this.addToHistory(userId, {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      });

      this.addToHistory(userId, {
        role: 'assistant',
        content: result.output,
        timestamp: new Date(),
      });

      const fallbackDuration = Date.now() - fallbackStartTime;
      const totalDuration = Date.now() - originalStartTime;
      
      this.logger.log(`✅ Successfully processed message with fallback model (${this.config.fallbackModel}) for user ${userId} (fallback: ${fallbackDuration}ms, total: ${totalDuration}ms)`);
      
      // Log model switching event for monitoring
      this.logModelSwitch(userId, this.config.defaultModel, this.config.fallbackModel, 'success', totalDuration);
      
      return result.output;

    } catch (error) {
      const fallbackDuration = Date.now() - fallbackStartTime;
      const totalDuration = Date.now() - originalStartTime;
      
      this.logger.error(`❌ Fallback model (${this.config.fallbackModel}) also failed for user ${userId} after ${fallbackDuration}ms:`, error);
      
      // Log failed model switching event
      this.logModelSwitch(userId, this.config.defaultModel, this.config.fallbackModel, 'failed', totalDuration);
      
      throw new Error(`Both primary (${this.config.defaultModel}) and fallback (${this.config.fallbackModel}) models failed`);
    }
  }

  private convertToLangChainMessages(history: LangChainConversationMessage[]): BaseMessage[] {
    return history.map(msg => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content);
      } else {
        // For system messages, we'll treat them as AI messages for now
        return new AIMessage(msg.content);
      }
    });
  }

  // Method for intent-based processing
  async processMessageWithIntent(userId: string, message: string, requestId: string): Promise<string> {
    if (!this.isInitialized || !this.agentExecutor) {
      throw new Error('LangChain agent not initialized');
    }

    const startTime = Date.now();
    
    try {
      this.logger.log(`🔄 Processing message with intent detection for user ${userId} (${requestId})`);

      // Create message context for intent detection
      const messageContext: MessageContext = {
        userId,
        messageText: message,
        conversationHistory: this.getUserHistory(userId),
        timestamp: new Date(),
        requestId
      };

      // Detect intent (this would use IntentDetectionService in a full implementation)
      // For now, we'll do basic intent detection
      const detectedIntent = this.detectBasicIntent(message);
      messageContext.detectedIntent = detectedIntent;

      this.logger.debug(`Intent detected: ${detectedIntent.intent} (confidence: ${detectedIntent.confidence})`);

      // Process based on intent
      let result: string;
      switch (detectedIntent.intent) {
        case 'web_search':
          result = await this.processWebSearchIntent(userId, message, requestId, messageContext);
          break;
        case 'mcp_tools':
          result = await this.processMCPToolsIntent(userId, message, requestId, messageContext);
          break;
        case 'general_chat':
        default:
          result = await this.processMessage(userId, message, requestId);
          break;
      }

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Intent-based processing completed for user ${userId} (${duration}ms)`);
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Intent-based processing failed for user ${userId} after ${duration}ms:`, error);
      
      // Fallback to regular processing
      this.logger.warn(`🔄 Falling back to regular processing for user ${userId}`);
      return await this.processMessage(userId, message, requestId);
    }
  }

  private detectBasicIntent(message: string): any {
    const lowerMessage = message.toLowerCase();
    
    // Explicit search commands (high confidence)
    const explicitSearchPatterns = [
      /^(search for|lookup|look up|find|google)\s+/i,
      /^(can you|please|could you)\s+(search for|lookup|look up|find)\s+/i,
      /what.*latest|what.*current|what.*today/i
    ];
    
    if (explicitSearchPatterns.some(pattern => pattern.test(message))) {
      return {
        intent: 'web_search',
        confidence: 0.95,
        searchQuery: this.extractSearchQuery(message)
      };
    }
    
    // Web search keywords (medium confidence)
    const webSearchKeywords = [
      'latest', 'news', 'current', 'today', 'recent', 'now',
      'weather', 'temperature', 'forecast',
      'stock', 'price', 'market', 'trading',
      'breaking', 'update', 'happening',
      'score', 'result', 'match', 'game'
    ];
    
    const webSearchCount = webSearchKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
    if (webSearchCount > 0) {
      const confidence = Math.min(0.7 + (webSearchCount * 0.1), 0.9);
      return {
        intent: 'web_search',
        confidence,
        searchQuery: this.extractSearchQuery(message)
      };
    }

    // Time-sensitive questions (medium confidence)
    const timeSensitivePatterns = [
      /what.*happening/i,
      /what.*going on/i,
      /tell me about.*today/i,
      /what.*new/i
    ];
    
    if (timeSensitivePatterns.some(pattern => pattern.test(message))) {
      return {
        intent: 'web_search',
        confidence: 0.75,
        searchQuery: this.extractSearchQuery(message)
      };
    }

    // MCP tools keywords
    const mcpToolsKeywords = ['send email', 'schedule', 'create', 'add to calendar', 'list emails'];
    if (mcpToolsKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return {
        intent: 'mcp_tools',
        confidence: 0.8,
        suggestedTools: ['email', 'calendar']
      };
    }

    // Default to general chat
    return {
      intent: 'general_chat',
      confidence: 0.6
    };
  }

  /**
   * Extract search query from user message
   */
  private extractSearchQuery(message: string): string {
    // Remove common question words and phrases
    const patterns = [
      /^(search for|lookup|look up|find|google|what is|what are|tell me about|show me)\s+/i,
      /^(can you|please|could you)\s+(search for|lookup|look up|find|tell me about)\s+/i,
      /^(what.*latest|what.*current|what.*today)\s+/i,
      /\?$/
    ];

    let query = message;
    patterns.forEach(pattern => {
      query = query.replace(pattern, '');
    });

    return query.trim() || message;
  }

  private async processWebSearchIntent(userId: string, message: string, requestId: string, _context: MessageContext): Promise<string> {
    this.logger.debug(`Processing web search intent for user ${userId}`);
    
    // For now, just add a note about web search capability
    const baseResponse = await this.processMessage(userId, message, requestId);
    return `🔍 Web search capability detected. ${baseResponse}`;
  }

  private async processMCPToolsIntent(userId: string, message: string, requestId: string, _context: MessageContext): Promise<string> {
    this.logger.debug(`Processing MCP tools intent for user ${userId}`);
    
    // For now, just add a note about MCP tools capability
    const baseResponse = await this.processMessage(userId, message, requestId);
    return `🔧 MCP tools capability detected. ${baseResponse}`;
  }

  // Method to get available tools
  async getAvailableTools(): Promise<Tool[]> {
    try {
      return await this.toolManager.getAllTools();
    } catch (error) {
      this.logger.error('❌ Failed to get available tools:', error);
      return [];
    }
  }

  // Method to refresh tools
  async refreshTools(): Promise<void> {
    try {
      this.logger.log('🔄 Refreshing tools and recreating agent executor...');
      await this.toolManager.refreshTools();
      
      // Recreate agent executor with updated tools
      this.agentExecutor = await this.createAgentExecutor(this.config.defaultModel);
      
      this.logger.log('✅ Tools refreshed and agent executor updated');
    } catch (error) {
      this.logger.error('❌ Failed to refresh tools:', error);
      throw error;
    }
  }

  /**
   * Load tools safely with error handling and graceful degradation
   */
  private async loadToolsSafely(): Promise<Tool[]> {
    try {
      this.logger.log('🔧 Loading tools from tool manager...');
      const tools = await this.toolManager.getAllTools();
      
      this.logger.log(`✅ Successfully loaded ${tools.length} tools`);
      
      // Log each tool with details
      tools.forEach((tool, index) => {
        this.logger.log(`   ${index + 1}. ${tool.name} (source: ${(tool as any).source || 'unknown'})`);
        this.logger.debug(`      Description: ${tool.description}`);
      });
      
      return tools;
    } catch (error) {
      this.logger.error('❌ Failed to load tools from tool manager, attempting individual tool loading:', error);
      
      // Try to load tools individually as fallback
      const partialTools: Tool[] = [];
      
      try {
        // Try to load Brave search tool specifically
        const braveSearchTool = this.toolManager.createBraveSearchTool();
        partialTools.push(braveSearchTool);
        this.logger.log('✅ Brave search tool loaded individually');
      } catch (braveError) {
        this.logger.warn('❌ Brave search tool failed to load individually:', braveError);
      }
      
      try {
        // Try to load MCP tools
        const mcpTools = await this.toolManager.discoverMCPTools();
        partialTools.push(...mcpTools);
        this.logger.log(`✅ ${mcpTools.length} MCP tools loaded individually`);
      } catch (mcpError) {
        this.logger.warn('❌ MCP tools failed to load individually:', mcpError);
      }
      
      if (partialTools.length > 0) {
        this.logger.log(`⚠️ Partial tool loading successful: ${partialTools.length} tools available`);
      } else {
        this.logger.warn('⚠️ No tools could be loaded, agent will work without tools');
      }
      
      return partialTools;
    }
  }

  // Method to get memory for user (will be implemented in later tasks)
  getMemoryForUser(userId: string): any {
    // For now, return the conversation history
    return this.getUserHistory(userId);
  }

  // Method to clear memory for user
  clearMemoryForUser(userId: string): void {
    this.clearHistory(userId);
  }

  /**
   * Execute agent with timeout and error handling
   */
  private async executeWithModel(
    executor: AgentExecutor, 
    input: string, 
    chatHistory: BaseMessage[], 
    modelType: string
  ): Promise<any> {
    const timeout = this.config.toolTimeout || 30000;
    
    this.logger.debug(`🚀 Executing agent with model: ${modelType}`);
    this.logger.debug(`   Input: "${input}"`);
    this.logger.debug(`   Chat history length: ${chatHistory.length}`);
    this.logger.debug(`   Timeout: ${timeout}ms`);
    
    const executionPromise = executor.invoke({
      input,
      chat_history: chatHistory,
    });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${modelType} model execution timeout after ${timeout}ms`)), timeout)
    );
    
    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * Log model switching events for monitoring and debugging
   */
  private logModelSwitch(
    userId: string, 
    primaryModel: string, 
    fallbackModel: string, 
    result: 'success' | 'failed', 
    duration: number
  ): void {
    const logData = {
      event: 'model_switch',
      userId,
      primaryModel,
      fallbackModel,
      result,
      duration,
      timestamp: new Date().toISOString(),
    };

    if (result === 'success') {
      this.logger.warn(`🔄 Model switch successful: ${JSON.stringify(logData)}`);
    } else {
      this.logger.error(`❌ Model switch failed: ${JSON.stringify(logData)}`);
    }

    // In a production environment, you might want to send this to a monitoring service
    // Example: this.metricsService.recordModelSwitch(logData);
  }

  /**
   * Check if primary model is available
   */
  async isPrimaryModelAvailable(): Promise<boolean> {
    try {
      if (!this.primaryModel) {
        return false;
      }

      // Simple health check - try to generate a minimal response
      const testResult = await Promise.race([
        this.primaryModel.invoke([new HumanMessage('test')]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);

      return !!testResult;
    } catch (error) {
      this.logger.warn(`🔍 Primary model (${this.config.defaultModel}) health check failed:`, error);
      return false;
    }
  }

  /**
   * Check if fallback model is available
   */
  async isFallbackModelAvailable(): Promise<boolean> {
    try {
      if (!this.fallbackModel) {
        return false;
      }

      // Simple health check - try to generate a minimal response
      const testResult = await Promise.race([
        this.fallbackModel.invoke([new HumanMessage('test')]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);

      return !!testResult;
    } catch (error) {
      this.logger.warn(`🔍 Fallback model (${this.config.fallbackModel}) health check failed:`, error);
      return false;
    }
  }

  /**
   * Get model health status
   */
  async getModelHealthStatus(): Promise<{
    primary: { model: string; available: boolean };
    fallback: { model: string; available: boolean };
  }> {
    const [primaryAvailable, fallbackAvailable] = await Promise.all([
      this.isPrimaryModelAvailable(),
      this.isFallbackModelAvailable(),
    ]);

    return {
      primary: {
        model: this.config.defaultModel,
        available: primaryAvailable,
      },
      fallback: {
        model: this.config.fallbackModel,
        available: fallbackAvailable,
      },
    };
  }

  /**
   * Force switch to fallback model (for testing or emergency situations)
   */
  async switchToFallbackModel(): Promise<void> {
    try {
      this.logger.warn(`🔄 Manually switching to fallback model (${this.config.fallbackModel})`);
      
      // Create new agent executor with fallback model
      this.agentExecutor = await this.createAgentExecutor(this.config.fallbackModel);
      
      // Swap the models
      const temp = this.primaryModel;
      this.primaryModel = this.fallbackModel;
      this.fallbackModel = temp;
      
      // Update config to reflect the switch
      const tempModelName = this.config.defaultModel;
      this.config.defaultModel = this.config.fallbackModel;
      this.config.fallbackModel = tempModelName;
      
      this.logger.log(`✅ Successfully switched to fallback model (${this.config.defaultModel})`);
    } catch (error) {
      this.logger.error('❌ Failed to switch to fallback model:', error);
      throw error;
    }
  }
}