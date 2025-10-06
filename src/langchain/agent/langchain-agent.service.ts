import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
// Removed hub import - using custom prompt instead

import { IAgentService } from '../../agent/agent.interface';
import { BaseAgentService } from '../../agent/base-agent.service';
import { LangChainConfigService } from '../config/langchain-config.service';
import { LangChainToolManagerService } from '../tools/tool-manager.service';
import { GreetingResponseService } from '../responses/greeting-response.service';
import { EmailHandlerService } from '../services/email-handler.service';
import { BraveService } from '../../webSearch/brave.service';
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
    private greetingService: GreetingResponseService,
    private emailHandler: EmailHandlerService,
    private braveService: BraveService,
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

      // Initialize models only (lazy load agent executor)
      this.primaryModel = this.createModel(this.config.defaultModel);
      this.fallbackModel = this.createModel(this.config.fallbackModel);

      // Don't create agent executor here - do it lazily when needed
      // This avoids loading all tools during startup

      this.isInitialized = true;
      this.logger.log(`✅ LangChain agent initialized with ${this.config.defaultModel} as primary model (lazy tool loading enabled)`);
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

      // Get current date/time info for context
      const now = new Date();
      const currentDateTime = now.toLocaleString('en-US', {
        timeZone: 'Europe/Paris',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const isoDateTime = now.toISOString();

      // Create a simplified ReAct prompt optimized for speed and reliability
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", `You are Jarvis, Leo's personal AI assistant. Be casual, helpful, and conversational.

CURRENT CONTEXT:
- Current date/time: ${currentDateTime} (CEST - Europe/Paris timezone)
- ISO format: ${isoDateTime}
- Timezone: Europe/Paris (CEST/CET)

PERSONALITY:
- Talk like a friend, not a robot
- Keep responses SHORT and natural
- Use tools when needed, but answer directly when you can
- Be helpful without being overly formal

WHEN TO USE TOOLS:
- Emails: Use search_gmail_messages + get_gmail_messages_content_batch
- Web search: Use brave_search for current info, news, weather
  * Extract ONLY the search term/company/topic from user's message
  * Example: "look up Limova.ai" → query: "Limova.ai"
  * Example: "search for weather in Paris" → query: "weather Paris"
- Calendar: Use create_event, modify_event, get_events for scheduling
- For general questions, knowledge, or chat: Just answer directly!

CRITICAL RULES:
1. Leo's email: l.mangallon@gmail.com (NEVER ask for this)
2. For calendar events:
   - Use ISO 8601 format: "2025-10-07T08:00:00" for 8am on Oct 7, 2025
   - Timezone: "Europe/Paris" (CEST/CET)
   - Calendar ID is always "primary" unless specified
   - When user says "Tuesday" or "next week", calculate from current date above
3. NEVER show message IDs or links - only subjects and senders

Available tools: {tools}
Tool names: {tool_names}

OUTPUT FORMAT (FOLLOW EXACTLY):

Step 1 - Use a tool:
Thought: I need to [action]
Action: [exact_tool_name]
Action Input: {{"param": "value"}}

Step 2 - After seeing tool result:
Thought: The tool returned [result]
Final Answer: [your response to Leo]

OR if no tool needed:
Final Answer: [your response to Leo]

CRITICAL FORMAT RULES: 
- NEVER put multiple actions in one response
- NEVER put Final Answer on the same line as an Action
- Keep Final Answer natural and conversational
- Don't add "Let me know..." or other meta-commentary
- If you see a tool result, immediately give Final Answer`],
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
        ["assistant", "{agent_scratchpad}"]
      ]);

      // Create the agent
      const agent = await createReactAgent({
        llm: model,
        tools,
        prompt,
      });

      // Create and return the agent executor with optimized settings
      const executor = new AgentExecutor({
        agent,
        tools,
        verbose: true, // Enable verbose for debugging
        maxIterations: 10, // Increased for complex multi-step tasks
        returnIntermediateSteps: true,
        handleParsingErrors: (error: Error) => {
          // Custom parsing error handler - extract useful content from malformed responses
          this.logger.warn(`⚠️ Parsing error occurred: ${error.message.substring(0, 200)}`);

          const errorMessage = error.message;

          // PRIORITY: Check if there's a valid Action that should be executed
          // This happens when LLM provides both action and final answer
          const actionMatch = errorMessage.match(/Action:\s*(\w+)\s*\nAction Input:\s*(\{[\s\S]*?\})/i);
          if (actionMatch && actionMatch[1] && actionMatch[2]) {
            const actionName = actionMatch[1].trim();
            const actionInput = actionMatch[2].trim();

            // Verify it's a valid tool
            const validTools = tools.map(t => t.name);
            if (validTools.includes(actionName)) {
              this.logger.log(`🔧 Extracted valid action from parsing error: ${actionName}`);
              // Return properly formatted action for the agent to execute
              return `Thought: I need to execute the action\nAction: ${actionName}\nAction Input: ${actionInput}`;
            }
          }

          // Extract the actual LLM output (before "Troubleshooting URL")
          const outputMatch = errorMessage.match(/Could not parse LLM output:\s*(.+?)(?:\n\nTroubleshooting|$)/is);
          if (outputMatch && outputMatch[1]) {
            const llmOutput = outputMatch[1].trim();

            // Check if it's a simple conversational response (greeting, question, short answer)
            const isSimpleResponse = (
              llmOutput.length < 500 &&
              llmOutput.match(/[.!?]$/) &&
              !llmOutput.includes('Action:') &&
              !llmOutput.includes('Thought:')
            );

            if (isSimpleResponse) {
              this.logger.log(`✅ Detected simple conversational response, returning directly`);
              // Return with proper ReAct format to signal completion
              return `Thought: I have the answer\nFinal Answer: ${llmOutput}`;
            }
          }

          // Try to extract Final Answer if it exists in the error (but only if no action was found)
          const finalAnswerMatch = errorMessage.match(/Final Answer:\s*(.+?)(?:\n\n|Troubleshooting|$)/is);
          if (finalAnswerMatch && finalAnswerMatch[1]) {
            const answer = finalAnswerMatch[1].trim();
            // Only use this if there's no action in the message
            if (answer.length > 10 && answer.length < 1000 && !errorMessage.includes('Action:')) {
              this.logger.log(`✅ Extracted Final Answer from parsing error`);
              return `Thought: I have the answer\nFinal Answer: ${answer}`;
            }
          }

          // Check if the error contains actual content we can use
          if (errorMessage.includes('Here are your') || errorMessage.includes('📧')) {
            const contentMatch = errorMessage.match(/Here are your[^:]*:([\s\S]*?)(?:Let me know|Troubleshooting|$)/i);
            if (contentMatch && contentMatch[1]) {
              const extractedContent = contentMatch[1].trim();
              this.logger.log(`✅ Extracted email content from parsing error`);
              return `Thought: I have the results\nFinal Answer: ${extractedContent}`;
            }
          }

          // For specific actions, provide targeted guidance
          if (errorMessage.includes('send_gmail_message') || errorMessage.includes('email')) {
            this.logger.log(`📧 Email action detected in parsing error`);
            return `Invalid format. Use:\nThought: I need to send an email\nAction: send_gmail_message\nAction Input: {parameters}`;
          }

          if (errorMessage.includes('create_event') || errorMessage.includes('calendar')) {
            this.logger.log(`🗓️ Calendar action detected in parsing error`);
            return `Invalid format. Use:\nThought: I need to create a calendar event\nAction: create_event\nAction Input: {parameters}`;
          }

          // Default: simple retry instruction
          return `Invalid format. Respond with ONLY:\nFinal Answer: [your response]`;
        },
      });

      this.logger.log(`✅ Agent executor created successfully`);
      this.logger.log(`   - Model: ${modelType}`);
      this.logger.log(`   - Tools: ${tools.length} available`);
      this.logger.log(`   - Max iterations: 5`);
      this.logger.log(`   - Verbose: true`);
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
          model: 'gemini-2.0-flash-exp',
          temperature: 0, // Zero temperature for maximum consistency and format adherence
          maxOutputTokens: Math.min(this.config.maxTokens, 1000), // Limit tokens for faster response
        });
      } else {
        const apiKey = this.langChainConfigService.getOpenAIApiKey();
        if (!apiKey) {
          throw new Error('OpenAI API key not configured');
        }

        return new ChatOpenAI({
          apiKey,
          modelName: 'gpt-4o-mini',
          temperature: 0, // Zero temperature for maximum consistency and format adherence
          maxTokens: Math.min(this.config.maxTokens, 1000), // Limit tokens for faster response
          timeout: 15000, // 15 second timeout
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
    if (!this.isInitialized) {
      throw new Error('LangChain agent not initialized');
    }

    const startTime = Date.now();

    try {
      this.logger.log(`🔄 [${requestId}] Processing message for user ${userId} with ${this.config.defaultModel} model`);
      this.logger.log(`📝 [${requestId}] Message: "${userMessage}"`);

      // Fast-path for simple conversational questions (opinions, thoughts, etc.)
      if (this.isSimpleConversationalQuestion(userMessage)) {
        this.logger.log(`💬 [${requestId}] Simple conversational question detected, answering directly`);
        const conversationalResponse = await this.handleConversationalQuestion(userMessage, userId, requestId);

        const duration = Date.now() - startTime;
        this.logger.log(`⚡ [${requestId}] Conversational response completed in ${duration}ms`);

        // Add to history
        this.addToHistory(userId, {
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
        });
        this.addToHistory(userId, {
          role: 'assistant',
          content: conversationalResponse,
          timestamp: new Date(),
        });

        return conversationalResponse;
      }

      // Fast-path for simple greetings and capability questions
      const fastResponse = await this.tryFastPathResponse(userMessage, userId, requestId);
      if (fastResponse) {
        const duration = Date.now() - startTime;
        this.logger.log(`⚡ [${requestId}] Fast-path response completed in ${duration}ms`);

        // Add to history
        this.addToHistory(userId, {
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
        });
        this.addToHistory(userId, {
          role: 'assistant',
          content: fastResponse,
          timestamp: new Date(),
        });

        return fastResponse;
      }

      // Fast-path for reading emails - use dedicated email handler
      if (this.isEmailRequest(userMessage)) {
        this.logger.log(`📧 [${requestId}] Email read request detected, using dedicated handler`);
        const emailResponse = await this.handleEmailRequest(userMessage, userId, requestId);

        const duration = Date.now() - startTime;
        this.logger.log(`⚡ [${requestId}] Email request completed in ${duration}ms`);

        // Add to history
        this.addToHistory(userId, {
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
        });
        this.addToHistory(userId, {
          role: 'assistant',
          content: emailResponse,
          timestamp: new Date(),
        });

        return emailResponse;
      }

      // Fast-path for sending emails - bypass agent complexity
      if (this.isSendEmailRequest(userMessage)) {
        this.logger.log(`📧 [${requestId}] Send email request detected, using direct handler`);
        const sendResponse = await this.handleSendEmailDirect(userMessage, userId, requestId);

        const duration = Date.now() - startTime;
        this.logger.log(`⚡ [${requestId}] Send email completed in ${duration}ms`);

        // Add to history
        this.addToHistory(userId, {
          role: 'user',
          content: userMessage,
          timestamp: new Date(),
        });
        this.addToHistory(userId, {
          role: 'assistant',
          content: sendResponse,
          timestamp: new Date(),
        });

        return sendResponse;
      }

      // DISABLED: Optimized email processing - needs proper implementation with batch content fetching
      // The MCP search only returns message IDs, not actual email content
      // For now, let the full agent handle email requests properly
      // if (this.isSimpleEmailRequest(userMessage)) {
      //   this.logger.log(`📧 [${requestId}] Detected simple email request, using optimized processing`);
      //   ...
      // }

      // Ensure agent executor is ready for complex queries
      if (!this.agentExecutor) {
        this.logger.log(`🔧 [${requestId}] Creating agent executor for complex query...`);
        this.agentExecutor = await this.createAgentExecutor(this.config.defaultModel);
      }

      // Get conversation history
      const history = this.getUserHistory(userId);
      const chatHistory = this.convertToLangChainMessages(history);

      this.logger.debug(`💭 [${requestId}] Chat history: ${chatHistory.length} messages`);

      // Log available tools before execution
      const availableTools = await this.getAvailableTools();
      this.logger.log(`🛠️  [${requestId}] Available tools: ${availableTools.length} (${availableTools.map(t => t.name).join(', ')})`);

      // Execute the agent with primary model
      this.logger.debug(`🚀 [${requestId}] Invoking agent executor...`);
      this.logger.debug(`🚀 [${requestId}] Agent executor configured: ${!!this.agentExecutor}`);

      const result = await this.executeWithModel(this.agentExecutor, userMessage, chatHistory, this.config.defaultModel);

      this.logger.debug(`🚀 [${requestId}] Agent execution returned`);
      this.logger.debug(`🚀 [${requestId}] Result keys: ${JSON.stringify(Object.keys(result || {}))}`);

      // Log intermediate steps if available
      if (result.intermediateSteps && result.intermediateSteps.length > 0) {
        this.logger.log(`🔧 [${requestId}] Agent used ${result.intermediateSteps.length} tool call(s):`);
        result.intermediateSteps.forEach((step: any, index: number) => {
          const toolName = step.action?.tool || 'unknown';
          const toolInput = JSON.stringify(step.action?.toolInput || {}).substring(0, 200);
          const observation = step.observation ? step.observation.substring(0, 300) : 'none';
          this.logger.log(`   📍 Step ${index + 1}: ${toolName}`);
          this.logger.log(`      Input: ${toolInput}`);
          this.logger.log(`      Result: ${observation}...`);
        });
      } else {
        this.logger.warn(`⚠️  [${requestId}] No tools were called by the agent`);
      }

      // Clean up the output to remove any parsing artifacts
      const cleanedOutput = this.cleanAgentOutput(result.output);

      // Add messages to history
      this.addToHistory(userId, {
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      });

      this.addToHistory(userId, {
        role: 'assistant',
        content: cleanedOutput,
        timestamp: new Date(),
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ [${requestId}] Successfully processed message for user ${userId} with ${this.config.defaultModel} model (${duration}ms)`);
      this.logger.log(`📤 [${requestId}] Response: "${cleanedOutput.substring(0, 150)}${cleanedOutput.length > 150 ? '...' : ''}"`);

      return cleanedOutput;

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
    // First, try to extract content within quotes
    const quotedMatch = message.match(/["']([^"']+)["']/);
    if (quotedMatch && quotedMatch[1]) {
      return quotedMatch[1].trim();
    }

    // Remove common question words and phrases
    const patterns = [
      /^(oh and |and |so |well |hey |hi |hello )/i,
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
    const loadStartTime = Date.now();

    try {
      this.logger.log('🔧 Loading tools from tool manager...');

      // Set a timeout for tool loading to prevent hanging
      const toolsPromise = this.toolManager.getAllTools();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tool loading timeout')), 10000); // 10 second timeout
      });

      const tools = await Promise.race([toolsPromise, timeoutPromise]);

      const loadDuration = Date.now() - loadStartTime;
      this.logger.log(`✅ Successfully loaded ${tools.length} tools in ${loadDuration}ms`);

      // Log each tool with details (but limit to avoid spam)
      const maxToolsToLog = 5;
      tools.slice(0, maxToolsToLog).forEach((tool, index) => {
        this.logger.log(`   ${index + 1}. ${(tool as any).name} (source: ${(tool as any).source || 'unknown'})`);
        this.logger.debug(`      Description: ${(tool as any).description?.substring(0, 100) || 'No description'}...`);
      });

      if (tools.length > maxToolsToLog) {
        this.logger.log(`   ... and ${tools.length - maxToolsToLog} more tools`);
      }

      return tools;
    } catch (error) {
      const loadDuration = Date.now() - loadStartTime;
      this.logger.error(`❌ Failed to load tools from tool manager after ${loadDuration}ms, attempting individual tool loading:`, error);

      // Try to load essential tools individually as fallback
      const partialTools: Tool[] = [];

      // Load tools in parallel with individual timeouts
      const toolLoadPromises = [
        this.loadBraveSearchTool(),
        this.loadMCPTools()
      ];

      const results = await Promise.allSettled(toolLoadPromises);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          partialTools.push(...result.value);
          const toolType = index === 0 ? 'Brave search' : 'MCP';
          this.logger.log(`✅ ${result.value.length} ${toolType} tool(s) loaded individually`);
        } else if (result.status === 'rejected') {
          const toolType = index === 0 ? 'Brave search' : 'MCP';
          this.logger.warn(`❌ ${toolType} tools failed to load:`, result.reason);
        }
      });

      if (partialTools.length > 0) {
        this.logger.log(`⚠️ Partial tool loading successful: ${partialTools.length} tools available`);
      } else {
        this.logger.warn('⚠️ No tools could be loaded, agent will work without tools');
      }

      return partialTools;
    }
  }

  /**
   * Load Brave search tool individually
   */
  private async loadBraveSearchTool(): Promise<Tool[]> {
    try {
      const braveSearchTool = this.toolManager.createBraveSearchTool();
      return [braveSearchTool];
    } catch (error) {
      this.logger.debug('Brave search tool not available:', error.message);
      return [];
    }
  }

  /**
   * Load MCP tools individually with timeout
   */
  private async loadMCPTools(): Promise<Tool[]> {
    try {
      const mcpToolsPromise = this.toolManager.discoverMCPTools();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('MCP tools loading timeout')), 8000); // 8 second timeout
      });

      const mcpTools = await Promise.race([mcpToolsPromise, timeoutPromise]);
      return mcpTools;
    } catch (error) {
      this.logger.debug('MCP tools not available:', error.message);
      return [];
    }
  }

  /**
   * Check if a message is a simple email request
   */
  private isSimpleEmailRequest(message: string): boolean {
    const normalizedMessage = message.toLowerCase().trim();
    const emailPatterns = [
      /^check.*email/i,
      /^show.*email/i,
      /^get.*email/i,
      /^my.*email/i,
      /^email/i,
      /^unread/i,
      /^inbox/i,
      /check.*unread.*email/i,
      /unread.*email/i,
      /email.*unread/i,
      /check.*enail/i, // Handle typos
      /unread.*enail/i
    ];

    return emailPatterns.some(pattern => pattern.test(normalizedMessage));
  }

  /**
   * Process email requests with optimized flow
   */
  private async processEmailRequestOptimized(message: string, userId: string, requestId: string): Promise<string | null> {
    this.logger.log(`📧 [${requestId}] Processing email request with optimized flow`);

    try {
      // Get tools quickly
      const tools = await this.getAvailableTools();
      const searchTool = tools.find(tool => (tool as any).name === 'search_gmail_messages');

      if (!searchTool) {
        throw new Error('Gmail search tool not available');
      }

      // Determine search parameters
      const normalizedMessage = message.toLowerCase();
      let query = 'in:inbox';
      let pageSize = 10;

      if (normalizedMessage.includes('unread')) {
        query = 'is:unread in:inbox';
        pageSize = 5; // Fewer unread emails typically
      }

      // Execute search with timeout
      this.logger.log(`🔍 [${requestId}] Searching emails: ${query}`);

      // Prepare the search parameters
      const searchParams = {
        query: query,
        user_google_email: 'l.mangallon@gmail.com',
        page_size: pageSize
      };

      this.logger.debug(`🔍 [${requestId}] Search parameters:`, searchParams);

      // Call the tool using the proper LangChain tool interface
      // LangChain DynamicTool expects a string input, so we need to stringify the params
      const searchPromise = searchTool.invoke(JSON.stringify(searchParams));

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Email search timeout')), 10000);
      });

      const searchResult = await Promise.race([searchPromise, timeoutPromise]);

      // Check if this is an authentication request
      if (searchResult && searchResult.includes('ACTION REQUIRED: Google Authentication Needed')) {
        this.logger.log(`🔐 [${requestId}] Authentication required, forwarding auth link to user`);

        // Extract the authorization URL from the response
        const authUrlMatch = searchResult.match(/Authorization URL: (https:\/\/[^\s\n]+)/);
        if (authUrlMatch && authUrlMatch[1]) {
          const authUrl = authUrlMatch[1];
          return `🔐 **Google Authentication Required**\n\nTo access your Gmail, please click this link to authorize:\n\n${authUrl}\n\nAfter authorizing, try your request again!`;
        }

        // Fallback if URL extraction fails
        return `🔐 **Google Authentication Required**\n\nI need permission to access your Gmail. Please check the logs for the authorization link, or try again in a moment.`;
      }

      // Format response quickly
      if (!searchResult || searchResult.includes('No messages found')) {
        return normalizedMessage.includes('unread')
          ? "No unread emails! 📭 You're all caught up! 🎉"
          : "No emails found! 📭";
      }

      // Simple response without complex parsing
      const emailCount = this.extractEmailCount(searchResult);
      const responsePrefix = normalizedMessage.includes('unread')
        ? `You have ${emailCount} unread email${emailCount !== 1 ? 's' : ''}:`
        : `Here's what you got (${emailCount} email${emailCount !== 1 ? 's' : ''}):`;

      return `${responsePrefix}\n\n📧 Check your Gmail for details - I found your emails but need to optimize the display format.`;

    } catch (error) {
      this.logger.warn(`❌ [${requestId}] Optimized email processing failed: ${error.message}`);
      return null; // Fall back to normal agent processing
    }
  }

  /**
   * Extract email count from search results
   */
  private extractEmailCount(searchResult: string): number {
    // Try to extract count from various possible formats
    const countPatterns = [
      /(\d+)\s+messages?\s+found/i,
      /found\s+(\d+)\s+messages?/i,
      /(\d+)\s+results?/i
    ];

    for (const pattern of countPatterns) {
      const match = searchResult.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    // Fallback: count message indicators
    const messageIndicators = searchResult.match(/Message ID:/g);
    return messageIndicators ? messageIndicators.length : 0;
  }

  /**
   * Check if message is a simple conversational question
   */
  private isSimpleConversationalQuestion(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const conversationalPatterns = [
      /what do you think/i,
      /what's your opinion/i,
      /what.*your thoughts/i,
      /how do you feel/i,
      /do you like/i,
      /do you think/i,
    ];

    return conversationalPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Handle conversational questions directly using the LLM
   */
  private async handleConversationalQuestion(message: string, userId: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`💬 [${requestId}] Answering conversational question directly`);

      // Get recent history for context
      const history = this.getUserHistory(userId);
      const recentHistory = history.slice(-3); // Last 3 messages for context

      // Build context from history
      let contextStr = '';
      if (recentHistory.length > 0) {
        contextStr = '\n\nRecent conversation:\n' + recentHistory.map(msg =>
          `${msg.role === 'user' ? 'Leo' : 'You'}: ${msg.content}`
        ).join('\n');
      }

      // Use the primary model directly without agent framework
      const model = this.getPrimaryModel();

      const prompt = `You are Jarvis, Leo's casual AI assistant. Answer this question naturally and conversationally.${contextStr}

Leo: ${message}
You:`;

      const response = await model.invoke(prompt);
      const answer = response.content.toString().trim();

      this.logger.log(`✅ [${requestId}] Conversational response generated`);
      return answer;

    } catch (error) {
      this.logger.error(`❌ [${requestId}] Conversational question failed:`, error);
      // Fallback to a generic response
      return "I'm not sure about that one. What else can I help you with?";
    }
  }

  /**
   * Check if message is a send email request
   */
  private isSendEmailRequest(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const sendPatterns = [
      /send.*email/i,
      /send.*test.*email/i,
      /email.*to/i,
      /compose.*email/i,
      /write.*email/i,
    ];

    return sendPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Handle send email request directly
   */
  private async handleSendEmailDirect(message: string, userId: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`📧 [${requestId}] Sending test email directly`);

      // For test emails, use simple defaults
      const tools = await this.getAvailableTools();
      const sendTool = tools.find(tool => (tool as any).name === 'send_gmail_message');

      if (!sendTool) {
        return "Sorry, email sending is not available right now.";
      }

      // Extract email address if provided
      const emailMatch = message.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const toEmail = emailMatch ? emailMatch[1] : 'l.mangallon@gmail.com';

      // Send test email
      const result = await sendTool.invoke(JSON.stringify({
        to: toEmail,
        subject: "Test Email from Jarvis",
        body: "This is a test email sent from your AI assistant!",
        user_google_email: 'l.mangallon@gmail.com',
      }));

      this.logger.log(`✅ [${requestId}] Email sent successfully`);

      return `Test email sent to ${toEmail}! 📧`;

    } catch (error) {
      this.logger.error(`❌ [${requestId}] Send email failed:`, error);
      return `Sorry, I couldn't send the email. ${error.message}`;
    }
  }

  /**
   * Check if message is an email read request
   */
  private isEmailRequest(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    const emailPatterns = [
      /^check.*email/i,
      /^show.*email/i,
      /^get.*email/i,
      /^read.*email/i,
      /^my.*email/i,
      /^email/i,
      /^unread/i,
      /^inbox/i,
      /check.*unread/i,
      /unread.*email/i,
      /email.*unread/i,
      /last.*\d+.*email/i,  // "last 5 emails", "last 10 emails"
      /give.*email/i,       // "give me emails", "give last emails"
      /show.*last.*email/i, // "show last emails"
      /pull.*email/i,       // "pull my emails", "pull last emails"
      /fetch.*email/i,      // "fetch emails"
      /list.*email/i,       // "list emails"
    ];

    return emailPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Handle email request directly with dedicated service
   */
  private async handleEmailRequest(message: string, userId: string, requestId: string): Promise<string> {
    try {
      const normalized = message.toLowerCase();
      const unreadOnly = normalized.includes('unread');

      // Extract number of emails requested (default to 10)
      let maxResults = 10;
      const numberMatch = normalized.match(/last\s+(\d+)|(\d+)\s+email|(\d+)\s+last/);
      if (numberMatch) {
        maxResults = parseInt(numberMatch[1] || numberMatch[2] || numberMatch[3], 10);
        maxResults = Math.min(maxResults, 25); // Cap at 25
      } else if (normalized.includes('last') && !normalized.match(/\d+/)) {
        // "last emails" without number defaults to 5
        maxResults = 5;
      }

      this.logger.log(`📧 [${requestId}] Fetching ${unreadOnly ? 'unread' : 'last'} ${maxResults} emails`);

      const result = await this.emailHandler.getRecentEmails({
        unreadOnly,
        maxResults,
        userEmail: 'l.mangallon@gmail.com',
      });

      // Check for errors (like auth required)
      if (result.error) {
        return result.error;
      }

      // Format and return emails
      if (result.emails.length === 0) {
        return unreadOnly
          ? "No unread emails! 📭 You're all caught up! 🎉"
          : "No emails found! 📭";
      }

      const formatted = this.emailHandler.formatEmailsForDisplay(result.emails);

      // Format with count and helpful suffix
      const emailType = unreadOnly ? 'unread' : 'recent';
      const header = `Here you go, ${emailType} squad (${result.emails.length}):\n`;
      const footer = result.emails.length > 0
        ? '\n\nWant me to pull full content for any of these? Just tell me the number.'
        : '';

      return header + formatted + footer;

    } catch (error) {
      this.logger.error(`❌ [${requestId}] Email request failed:`, error);
      return `Sorry, I couldn't retrieve your emails right now. ${error.message}`;
    }
  }

  /**
   * Clean agent output to remove parsing artifacts and conversational wrappers
   */
  private cleanAgentOutput(output: string): string {
    if (!output) return output;

    let cleaned = output;

    // Remove common conversational wrappers that violate the format
    const unwantedPrefixes = [
      /^Here are your [^:]*:\s*/i,
      /^Here's what [^:]*:\s*/i,
      /^Let me show you [^:]*:\s*/i,
      /^I found [^:]*:\s*/i,
    ];

    unwantedPrefixes.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove common conversational suffixes
    const unwantedSuffixes = [
      /\s*Let me know if you need anything else!?\s*$/i,
      /\s*Is there anything else I can help you with\??\s*$/i,
      /\s*Feel free to ask if you need more help!?\s*$/i,
      /\s*Troubleshooting URL:.*$/i,
    ];

    unwantedSuffixes.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove "Final Answer:" prefix if it leaked through
    cleaned = cleaned.replace(/^Final Answer:\s*/i, '');

    // Trim whitespace
    cleaned = cleaned.trim();

    return cleaned;
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
    const timeout = Math.min(this.config.toolTimeout || 40000, 40000); // Max 40 seconds for multi-step workflows

    this.logger.debug(`🚀 Executing agent with model: ${modelType}`);
    this.logger.debug(`   Input: "${input}"`);
    this.logger.debug(`   Chat history length: ${chatHistory.length}`);
    this.logger.debug(`   Timeout: ${timeout}ms`);

    // Limit chat history to last 3 messages for faster processing
    const limitedHistory = chatHistory.slice(-3);

    this.logger.debug(`🚀 Creating execution promise...`);
    const executionPromise = executor.invoke({
      input,
      chat_history: limitedHistory,
    });

    this.logger.debug(`🚀 Setting up timeout promise...`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        this.logger.error(`⏱️ Agent execution timeout after ${timeout}ms for model: ${modelType}`);
        reject(new Error(`${modelType} model execution timeout after ${timeout}ms`));
      }, timeout);

      // Store timeout ID for potential cleanup
      return timeoutId;
    });

    try {
      this.logger.debug(`🚀 Racing execution vs timeout...`);
      const result = await Promise.race([executionPromise, timeoutPromise]);
      this.logger.debug(`✅ Agent execution completed successfully for model: ${modelType}`);
      this.logger.debug(`✅ Result output length: ${result?.output?.length || 0} chars`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Agent execution failed for model: ${modelType}:`, error);

      // Check if it's a parsing error and try to extract useful response
      if (error.message.includes('Could not parse LLM output')) {
        this.logger.warn(`🔧 Attempting to extract response from parsing error...`);

        // Try multiple extraction patterns
        const patterns = [
          /Could not parse LLM output: (.+?)(?:\nTroubleshooting|$)/s,
          /Could not parse LLM output: (.+?)(?:\n|$)/,
          /output: (.+?)(?:\n|$)/i
        ];

        for (const pattern of patterns) {
          const match = error.message.match(pattern);
          if (match && match[1]) {
            let extractedResponse = match[1].trim();

            // Clean up the extracted response
            extractedResponse = extractedResponse.replace(/^["']|["']$/g, ''); // Remove quotes
            extractedResponse = extractedResponse.replace(/\\n/g, '\n'); // Fix newlines

            if (extractedResponse.length > 0 && extractedResponse.length < 1000) {
              this.logger.log(`✅ Extracted response from parsing error: "${extractedResponse.substring(0, 100)}..."`);
              return { output: extractedResponse };
            }
          }
        }

        // If extraction fails, provide a helpful fallback based on the input
        const fallbackResponse = this.generateFallbackResponse(input);
        this.logger.log(`🔧 Using fallback response for parsing error: "${fallbackResponse}"`);
        return { output: fallbackResponse };
      }

      throw error;
    }
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
   * Try to provide a fast-path response for simple queries without loading tools
   */
  private async tryFastPathResponse(message: string, userId: string, requestId: string): Promise<string | null> {
    const normalizedMessage = message.toLowerCase().trim();

    // Check for simple greetings - should be INSTANT
    const simpleGreetings = [
      /^hi\s*jarvis?$/i,
      /^hello\s*jarvis?$/i,
      /^hey\s*jarvis?$/i,
      /^yo\s*jarvis?$/i,
      /^sup\s*jarvis?$/i,
      /^hi$/i,
      /^hello$/i,
      /^hey$/i,
    ];

    if (simpleGreetings.some(pattern => pattern.test(message.trim()))) {
      this.logger.log(`⚡ [${requestId}] Fast-path: Simple greeting detected`);
      return this.greetingService.generateQuickGreeting(message);
    }

    // Check for greetings with questions
    if (this.greetingService.isSimpleGreeting(message)) {
      this.logger.log(`⚡ [${requestId}] Fast-path: Greeting with question detected`);
      const history = this.getUserHistory(userId);
      const shouldShowFull = this.greetingService.shouldShowFullGreeting(message, history);

      if (shouldShowFull) {
        return this.greetingService.generateGreetingResponse(message);
      } else {
        return this.greetingService.generateQuickGreeting(message);
      }
    }

    // Check for capability questions
    const capabilityPatterns = [
      /what can you do/i,
      /what do you do/i,
      /help me/i,
      /what are your capabilities/i,
      /what features/i,
      /how can you help/i
    ];

    if (capabilityPatterns.some(pattern => pattern.test(message))) {
      this.logger.log(`⚡ [${requestId}] Fast-path: Capability question detected`);
      return this.greetingService.generateGreetingResponse(message);
    }

    // Check for simple thank you messages
    const thankYouPatterns = [
      /^thanks?!?$/i,
      /^thank you!?$/i,
      /^ty!?$/i,
      /^thx!?$/i
    ];

    if (thankYouPatterns.some(pattern => pattern.test(normalizedMessage))) {
      this.logger.log(`⚡ [${requestId}] Fast-path: Thank you message detected`);
      const responses = [
        "You're welcome! 😊",
        "Happy to help! 🤖",
        "Anytime! 👍",
        "No problem! ⚡",
        "Glad I could help! 🚀"
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }

    // Check for web search requests - should be INSTANT
    const webSearchPatterns = [
      /what'?s?\s+(the\s+)?news/i,
      /what'?s?\s+happening/i,
      /search\s+for/i,
      /look\s+up/i,
      /find\s+out/i,
      /tell\s+me\s+about/i,
      /weather\s+in/i,
      /news\s+(in|about)/i,
    ];

    if (webSearchPatterns.some(pattern => pattern.test(message))) {
      this.logger.log(`⚡ [${requestId}] Fast-path: Web search detected`);
      return await this.handleWebSearchDirect(message, requestId);
    }

    // Calendar requests should go through agent (complex parsing needed)
    // But we can detect them early to ensure proper routing
    const calendarPatterns = [
      /create.*event/i,
      /add.*calendar/i,
      /schedule.*meeting/i,
      /remind.*me/i,
      /set.*reminder/i,
    ];

    if (calendarPatterns.some(pattern => pattern.test(message))) {
      this.logger.log(`🗓️ [${requestId}] Calendar request detected, routing to agent`);
      // Return null to let it go through the full agent with tools
      return null;
    }

    // No fast-path available
    return null;
  }

  /**
   * Handle web search directly without agent
   */
  private async handleWebSearchDirect(message: string, requestId: string): Promise<string> {
    try {
      // Extract search query
      const query = message
        .replace(/^(what'?s?\s+(the\s+)?|search\s+for\s+|look\s+up\s+|find\s+out\s+|tell\s+me\s+about\s+)/i, '')
        .trim();

      this.logger.log(`🔍 [${requestId}] Direct web search for: "${query}"`);

      const searchResult = await this.braveService.search({
        query,
        count: 3,
        country: 'us',
        search_lang: 'en',
      });

      // Format results
      if (!searchResult?.web?.results || searchResult.web.results.length === 0) {
        return `No results found for "${query}" 🤷`;
      }

      const results = searchResult.web.results.slice(0, 3);
      let response = `🔍 Here's what I found about "${query}":\n\n`;

      results.forEach((result: any, index: number) => {
        const title = result.title || 'No title';
        const description = result.description || 'No description';
        response += `${index + 1}. ${title}\n${description.substring(0, 150)}${description.length > 150 ? '...' : ''}\n\n`;
      });

      return response.trim();

    } catch (error) {
      this.logger.error(`❌ [${requestId}] Direct web search failed:`, error);
      return `Sorry, I couldn't search for that right now. ${error.message}`;
    }
  }

  /**
   * Handle email requests directly without the full agent flow
   */
  private async handleEmailRequestDirectly(message: string, userId: string, requestId: string): Promise<string> {
    this.logger.log(`📧 [${requestId}] Processing email request directly`);

    // Load tools if not already loaded
    const tools = await this.getAvailableTools();
    const searchTool = tools.find(tool => (tool as any).name === 'search_gmail_messages');

    if (!searchTool) {
      throw new Error('Gmail search tool not available');
    }

    // Determine search query based on message
    const normalizedMessage = message.toLowerCase();
    let query = 'in:inbox';

    if (normalizedMessage.includes('unread')) {
      query = 'is:unread in:inbox';
    }

    try {
      // Call the search tool directly
      this.logger.log(`🔍 [${requestId}] Searching emails with query: ${query}`);

      // Prepare the search parameters
      const searchParams = {
        query: query,
        user_google_email: 'l.mangallon@gmail.com',
        page_size: 10
      };

      this.logger.debug(`🔍 [${requestId}] Search parameters:`, searchParams);

      const searchResult = await searchTool.invoke(JSON.stringify(searchParams));

      // Check if this is an authentication request or error
      this.logger.debug(`🔍 [${requestId}] Search result preview: ${searchResult?.substring(0, 200)}...`);

      // Check for authentication errors (can be wrapped in "Error calling tool" prefix)
      if (searchResult && (searchResult.includes('ACTION REQUIRED: Google Authentication Needed') ||
        searchResult.includes('Google Authentication Needed'))) {
        this.logger.log(`🔐 [${requestId}] Authentication required, forwarding auth link to user`);

        // Extract the authorization URL from the response
        const authUrlMatch = searchResult.match(/Authorization URL: (https:\/\/[^\s\n]+)/);
        if (authUrlMatch && authUrlMatch[1]) {
          const authUrl = authUrlMatch[1];
          this.logger.log(`🔐 [${requestId}] Extracted auth URL: ${authUrl.substring(0, 100)}...`);
          return `🔐 **Google Authentication Required**\n\nTo access your Gmail, please click this link to authorize:\n\n${authUrl}\n\nAfter authorizing, try your request again!`;
        }

        // Fallback if URL extraction fails
        this.logger.warn(`🔐 [${requestId}] Could not extract auth URL from response`);
        return `🔐 **Google Authentication Required**\n\nI need permission to access your Gmail. Please check the logs for the authorization link, or try again in a moment.`;
      }

      // Check for any other errors from the tool
      if (searchResult && searchResult.includes('Error calling tool')) {
        this.logger.error(`❌ [${requestId}] Tool returned an error: ${searchResult.substring(0, 300)}`);
        throw new Error(`Gmail tool error: ${searchResult.substring(0, 200)}`);
      }

      // Parse and format the results
      if (searchResult && searchResult.includes('No messages found')) {
        return "No emails found! 📭";
      }

      // Extract email info and format properly
      const formattedEmails = this.formatEmailResults(searchResult);

      if (formattedEmails.length === 0) {
        return "No emails found! 📭";
      }

      const response = normalizedMessage.includes('unread')
        ? `Here are your unread emails:\n\n${formattedEmails.join('\n')}`
        : `Here's what you got:\n\n${formattedEmails.join('\n')}`;

      this.logger.log(`✅ [${requestId}] Direct email processing completed`);
      return response;

    } catch (error) {
      this.logger.error(`❌ [${requestId}] Direct email processing failed:`, error);
      throw error;
    }
  }

  /**
   * Format email search results into the proper display format
   */
  private formatEmailResults(searchResult: string): string[] {
    const emails: string[] = [];

    try {
      // Look for patterns in the search result that indicate emails
      const lines = searchResult.split('\n');

      for (const line of lines) {
        // Look for message entries (this is a simplified parser)
        if (line.includes('Message ID:') || line.includes('Subject:') || line.includes('From:')) {
          // This would need to be more sophisticated based on actual MCP tool output format
          // For now, return a placeholder that will trigger normal agent processing
          continue;
        }
      }

      // If we can't parse properly, throw to fall back to agent
      if (emails.length === 0) {
        throw new Error('Could not parse email results');
      }

    } catch (error) {
      this.logger.debug(`Could not parse email results directly: ${error.message}`);
      throw error;
    }

    return emails;
  }

  /**
   * Generate a fallback response when parsing fails
   */
  private generateFallbackResponse(input: string): string {
    const normalizedInput = input.toLowerCase();

    if (normalizedInput.includes('email')) {
      return "I understand you want to check your emails. Let me try a different approach - could you be more specific about what you're looking for?";
    }

    if (normalizedInput.includes('search') || normalizedInput.includes('find')) {
      return "I can help you search for information. Could you tell me more specifically what you're looking for?";
    }

    if (normalizedInput.includes('calendar') || normalizedInput.includes('schedule')) {
      return "I can help with your calendar. What would you like me to do - check your schedule, create an event, or something else?";
    }

    return "I'm having trouble processing that request right now. Could you try rephrasing it or being more specific about what you need?";
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