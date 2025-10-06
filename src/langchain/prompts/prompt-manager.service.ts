import { Injectable, Logger } from '@nestjs/common';
import { PromptTemplate, ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { LangChainConfigService } from '../config/langchain-config.service';
import { MessageContext } from '../interfaces/langchain-config.interface';
import { 
  ILangChainPromptManager, 
  PromptTemplateConfig, 
  PromptStrategy, 
  PromptContext,
  PromptValidationResult
} from './prompt-manager.interface';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class LangChainPromptManagerService implements ILangChainPromptManager {
  private readonly logger = new Logger(LangChainPromptManagerService.name);
  private promptTemplates: Map<string, PromptTemplate> = new Map();
  private chatPromptTemplates: Map<string, ChatPromptTemplate> = new Map();
  private promptStrategies: Map<string, PromptStrategy> = new Map();

  constructor(private readonly configService: LangChainConfigService) {
    this.initializeDefaultPrompts();
  }

  /**
   * Get system prompt template
   */
  getSystemPrompt(): PromptTemplate {
    const template = this.promptTemplates.get('system');
    if (template) {
      return template;
    }

    // Default system prompt
    const defaultSystemPrompt = new PromptTemplate({
      template: `You are a helpful AI assistant integrated with WhatsApp. You can:
- Answer questions using your knowledge
- Search the web for current information when needed
- Use various tools to help users with tasks
- Maintain conversation context and memory

Current time: {currentTime}
Available tools: {availableTools}

Be concise, helpful, and format responses appropriately for WhatsApp messaging.`,
      inputVariables: ['currentTime', 'availableTools']
    });

    this.promptTemplates.set('system', defaultSystemPrompt);
    return defaultSystemPrompt;
  }

  /**
   * Get user prompt template
   */
  getUserPrompt(context: string): PromptTemplate {
    return new PromptTemplate({
      template: `Context: {context}

User message: {userMessage}

Please respond appropriately based on the context and user's request.`,
      inputVariables: ['context', 'userMessage']
    });
  }

  /**
   * Get tool-specific prompt template
   */
  getToolPrompt(toolName: string): PromptTemplate {
    const template = this.promptTemplates.get(`tool_${toolName}`);
    if (template) {
      return template;
    }

    // Default tool prompt
    const defaultToolPrompt = new PromptTemplate({
      template: `You are about to use the {toolName} tool to help the user.

Tool description: {toolDescription}
User request: {userRequest}

Please use the tool appropriately and format the results for the user.`,
      inputVariables: ['toolName', 'toolDescription', 'userRequest']
    });

    this.promptTemplates.set(`tool_${toolName}`, defaultToolPrompt);
    return defaultToolPrompt;
  }

  /**
   * Get chat prompt template
   */
  getChatPrompt(): ChatPromptTemplate {
    const template = this.chatPromptTemplates.get('default_chat');
    if (template) {
      return template;
    }

    const defaultChatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You are a helpful AI assistant integrated with WhatsApp. 
        
Current time: {currentTime}
Available tools: {availableTools}

Be concise, helpful, and format responses appropriately for WhatsApp messaging.`
      ),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);

    this.chatPromptTemplates.set('default_chat', defaultChatPrompt);
    return defaultChatPrompt;
  }

  /**
   * Select prompt strategy based on message context
   */
  selectPromptStrategy(messageContext: MessageContext): ChatPromptTemplate {
    const intent = messageContext.detectedIntent?.intent || 'general_chat';
    
    switch (intent) {
      case 'web_search':
        return this.getWebSearchPrompt();
      case 'mcp_tools':
        return this.getMCPToolsPrompt();
      case 'general_chat':
      default:
        return this.getGeneralChatPrompt();
    }
  }

  /**
   * Build contextual prompt based on message context
   */
  async buildContextualPrompt(messageContext: MessageContext): Promise<ChatPromptTemplate> {
    const basePrompt = this.selectPromptStrategy(messageContext);
    
    // Add conversation history if available
    if (messageContext.conversationHistory && messageContext.conversationHistory.length > 0) {
      const historyContext = this.formatConversationHistory(messageContext.conversationHistory);
      
      return ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(
          `You are a helpful AI assistant integrated with WhatsApp.
          
Current time: {currentTime}
Available tools: {availableTools}

Conversation history:
{conversationHistory}

Be concise, helpful, and maintain context from the conversation history.`
        ),
        HumanMessagePromptTemplate.fromTemplate('{userMessage}')
      ]);
    }

    return basePrompt;
  }

  /**
   * Format prompt with context variables
   */
  async formatPromptWithContext(template: PromptTemplate, context: Record<string, any>): Promise<string> {
    try {
      return await template.format(context);
    } catch (error) {
      this.logger.error('Error formatting prompt:', error);
      throw new Error(`Failed to format prompt: ${error.message}`);
    }
  }

  /**
   * Update prompt template
   */
  updatePromptTemplate(name: string, template: string): void {
    try {
      // Validate template first
      const validation = this.validatePromptTemplate(template);
      if (!validation.isValid) {
        throw new Error(`Invalid prompt template: ${validation.errors.join(', ')}`);
      }

      const promptTemplate = new PromptTemplate({
        template,
        inputVariables: this.extractVariables(template)
      });

      this.promptTemplates.set(name, promptTemplate);
      this.logger.debug(`Updated prompt template: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to update prompt template ${name}:`, error);
      throw error;
    }
  }

  /**
   * Load prompts from configuration files
   */
  async loadPromptsFromConfig(): Promise<void> {
    try {
      const config = this.configService.getLangChainConfig();
      
      // Load system prompt if path is provided
      if (config.systemPromptPath) {
        await this.loadSystemPromptFromFile(config.systemPromptPath);
      }

      // Load prompt templates if path is provided
      if (config.promptTemplatesPath) {
        await this.loadPromptTemplatesFromDirectory(config.promptTemplatesPath);
      }

      this.logger.log('Prompts loaded from configuration');
    } catch (error) {
      this.logger.error('Failed to load prompts from config:', error);
      // Don't throw - use defaults instead
    }
  }

  /**
   * Get web search specific prompt
   */
  private getWebSearchPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You are a helpful AI assistant with web search capabilities.

When users ask for current information, recent news, or real-time data, use the brave_search tool to find up-to-date information.

Current time: {currentTime}
Available tools: {availableTools}

Format search results clearly and cite sources when possible.`
      ),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
  }

  /**
   * Get MCP tools specific prompt
   */
  private getMCPToolsPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You are a helpful AI assistant with access to various tools and services.

You can help users with tasks like:
- Sending emails
- Managing calendars
- Creating documents
- And other productivity tasks

Current time: {currentTime}
Available tools: {availableTools}

Use the appropriate tools to help users accomplish their tasks.`
      ),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
  }

  /**
   * Get general chat prompt
   */
  private getGeneralChatPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You are a helpful AI assistant integrated with WhatsApp.

Provide helpful, accurate, and concise responses. Be conversational and friendly.

Current time: {currentTime}

Format responses appropriately for WhatsApp messaging.`
      ),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
  }

  /**
   * Initialize default prompt templates
   */
  private initializeDefaultPrompts(): void {
    // Initialize default prompts
    this.getSystemPrompt();
    this.getChatPrompt();
    
    // Initialize prompt strategies
    this.initializePromptStrategies();
    
    this.logger.debug('Default prompts initialized');
  }

  /**
   * Initialize prompt strategies
   */
  private initializePromptStrategies(): void {
    const strategies: PromptStrategy[] = [
      {
        name: 'web_search',
        intent: 'web_search',
        systemPrompt: 'You are a helpful AI assistant with web search capabilities.',
        userPromptTemplate: 'User is asking: {userMessage}. Use web search if needed for current information.',
        contextInstructions: 'Consider if the query requires current/real-time information.',
        outputFormat: 'Provide clear, cited information from search results.'
      },
      {
        name: 'mcp_tools',
        intent: 'mcp_tools',
        systemPrompt: 'You are a helpful AI assistant with access to various productivity tools.',
        userPromptTemplate: 'User wants to: {userMessage}. Use appropriate tools to help.',
        contextInstructions: 'Identify which tools are needed for the task.',
        outputFormat: 'Confirm actions taken and provide results.'
      },
      {
        name: 'general_chat',
        intent: 'general_chat',
        systemPrompt: 'You are a helpful AI assistant for general conversation.',
        userPromptTemplate: 'User says: {userMessage}',
        contextInstructions: 'Provide helpful, conversational responses.',
        outputFormat: 'Be friendly and informative.'
      }
    ];

    strategies.forEach(strategy => {
      this.promptStrategies.set(strategy.name, strategy);
    });
  }

  /**
   * Format conversation history for prompts
   */
  private formatConversationHistory(history: any[]): string {
    return history
      .slice(-5) // Last 5 messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  /**
   * Extract variables from template string
   */
  private extractVariables(template: string): string[] {
    const matches = template.match(/\{([^}]+)\}/g);
    if (!matches) return [];
    
    return matches.map(match => match.slice(1, -1));
  }

  /**
   * Validate prompt template
   */
  private validatePromptTemplate(template: string): PromptValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingVariables: string[] = [];

    // Basic validation
    if (!template || template.trim().length === 0) {
      errors.push('Template cannot be empty');
    }

    // Check for unmatched braces
    const openBraces = (template.match(/\{/g) || []).length;
    const closeBraces = (template.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push('Unmatched braces in template');
    }

    // Check for common variables
    const variables = this.extractVariables(template);
    const commonVariables = ['userMessage', 'currentTime', 'availableTools'];
    
    commonVariables.forEach(variable => {
      if (template.includes(variable) && !variables.includes(variable)) {
        warnings.push(`Consider adding {${variable}} as a variable`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      missingVariables
    };
  }

  /**
   * Load system prompt from file
   */
  private async loadSystemPromptFromFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const template = new PromptTemplate({
        template: content,
        inputVariables: this.extractVariables(content)
      });
      
      this.promptTemplates.set('system', template);
      this.logger.debug(`Loaded system prompt from: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to load system prompt from ${filePath}:`, error);
    }
  }

  /**
   * Load prompt templates from directory
   */
  private async loadPromptTemplatesFromDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        if (file.endsWith('.txt') || file.endsWith('.md')) {
          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const name = path.basename(file, path.extname(file));
          
          const template = new PromptTemplate({
            template: content,
            inputVariables: this.extractVariables(content)
          });
          
          this.promptTemplates.set(name, template);
          this.logger.debug(`Loaded prompt template: ${name}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to load prompt templates from ${dirPath}:`, error);
    }
  }

  /**
   * Get all prompt template names
   */
  getPromptTemplateNames(): string[] {
    return Array.from(this.promptTemplates.keys());
  }

  /**
   * Get prompt template by name
   */
  getPromptTemplateByName(name: string): PromptTemplate | null {
    return this.promptTemplates.get(name) || null;
  }

  /**
   * Create context-aware prompt with user preferences
   */
  async createContextAwarePrompt(
    messageContext: MessageContext,
    userPreferences?: Record<string, any>
  ): Promise<ChatPromptTemplate> {
    const intent = messageContext.detectedIntent?.intent || 'general_chat';
    const strategy = this.promptStrategies.get(intent);
    
    if (!strategy) {
      return this.getChatPrompt();
    }

    // Build system message with context
    let systemMessage = strategy.systemPrompt;
    
    // Add user preferences if available
    if (userPreferences) {
      systemMessage += `\n\nUser preferences: ${JSON.stringify(userPreferences, null, 2)}`;
    }

    // Add conversation context
    if (messageContext.conversationHistory && messageContext.conversationHistory.length > 0) {
      const historyContext = this.formatConversationHistory(messageContext.conversationHistory);
      systemMessage += `\n\nConversation history:\n${historyContext}`;
    }

    // Add intent-specific instructions
    systemMessage += `\n\n${strategy.contextInstructions}`;
    systemMessage += `\n\nOutput format: ${strategy.outputFormat}`;

    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(systemMessage),
      HumanMessagePromptTemplate.fromTemplate(strategy.userPromptTemplate)
    ]);
  }

  /**
   * Create output parsing strategy based on intent
   */
  createOutputParsingStrategy(intent: string): {
    shouldStructure: boolean;
    format: 'json' | 'markdown' | 'plain' | 'whatsapp';
    instructions: string;
  } {
    switch (intent) {
      case 'web_search':
        return {
          shouldStructure: true,
          format: 'whatsapp',
          instructions: 'Format search results with emojis, clear headings, and source links. Keep it concise for mobile viewing.'
        };
      
      case 'mcp_tools':
        return {
          shouldStructure: true,
          format: 'whatsapp',
          instructions: 'Confirm actions taken, show results clearly, and use status emojis (✅❌⏳) for clarity.'
        };
      
      case 'general_chat':
      default:
        return {
          shouldStructure: false,
          format: 'plain',
          instructions: 'Respond naturally and conversationally. Be helpful and concise.'
        };
    }
  }

  /**
   * Generate dynamic prompt based on available tools
   */
  async generateDynamicPrompt(
    availableTools: string[],
    messageContext: MessageContext
  ): Promise<ChatPromptTemplate> {
    const toolDescriptions = this.generateToolDescriptions(availableTools);
    const intent = messageContext.detectedIntent?.intent || 'general_chat';
    
    let systemPrompt = `You are a helpful AI assistant with access to the following tools:

${toolDescriptions}

Current time: ${new Date().toISOString()}
User intent detected: ${intent}

Choose the most appropriate tool(s) based on the user's request. If no tools are needed, respond directly.`;

    // Add intent-specific guidance
    switch (intent) {
      case 'web_search':
        systemPrompt += '\n\nFor current information, news, or real-time data, use the brave_search tool.';
        break;
      case 'mcp_tools':
        systemPrompt += '\n\nFor productivity tasks, use the appropriate MCP tools available.';
        break;
      case 'general_chat':
        systemPrompt += '\n\nFor general questions, use your knowledge. Only use tools if specifically needed.';
        break;
    }

    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(systemPrompt),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
  }

  /**
   * Create prompt with conversation memory integration
   */
  async createMemoryAwarePrompt(
    messageContext: MessageContext,
    memoryContext: string
  ): Promise<ChatPromptTemplate> {
    const basePrompt = await this.buildContextualPrompt(messageContext);
    
    // Enhance with memory context
    const enhancedSystemPrompt = `You are a helpful AI assistant with memory of past conversations.

Memory context:
${memoryContext}

Use this context to provide more personalized and contextually relevant responses.
Reference previous conversations when appropriate, but don't overwhelm the user with too much history.

Current time: {currentTime}
Available tools: {availableTools}`;

    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(enhancedSystemPrompt),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
  }

  /**
   * Generate tool descriptions for prompts
   */
  private generateToolDescriptions(toolNames: string[]): string {
    const toolDescriptions = toolNames.map(toolName => {
      switch (toolName) {
        case 'brave_search':
          return '- brave_search: Search the web for current information, news, and real-time data';
        default:
          return `- ${toolName}: Available tool for various tasks`;
      }
    });

    return toolDescriptions.join('\n');
  }

  /**
   * Create error handling prompt
   */
  createErrorHandlingPrompt(error: string, originalMessage: string): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `An error occurred while processing the user's request: {error}

Original user message: {originalMessage}

Please provide a helpful response that:
1. Acknowledges the issue
2. Suggests alternative approaches if possible
3. Maintains a positive and helpful tone
4. Doesn't expose technical details to the user`
      ),
      HumanMessagePromptTemplate.fromTemplate('Please help the user despite the error.')
    ]);
  }

  /**
   * Create fallback prompt when tools fail
   */
  createFallbackPrompt(failedTools: string[], originalMessage: string): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `The following tools failed to execute: {failedTools}

Original user request: {originalMessage}

Please provide the best possible response using your knowledge, and explain any limitations.
Be honest about what you cannot do without the tools, but still try to be helpful.`
      ),
      HumanMessagePromptTemplate.fromTemplate('Provide the best response possible without the failed tools.')
    ]);
  }

  /**
   * Validate prompt context completeness
   */
  validatePromptContext(context: Record<string, any>, requiredVariables: string[]): {
    isComplete: boolean;
    missingVariables: string[];
  } {
    const missingVariables = requiredVariables.filter(variable => 
      !(variable in context) || context[variable] === undefined || context[variable] === null
    );

    return {
      isComplete: missingVariables.length === 0,
      missingVariables
    };
  }

  /**
   * Get prompt statistics
   */
  getPromptStats(): {
    totalTemplates: number;
    totalStrategies: number;
    mostUsedStrategy?: string;
  } {
    return {
      totalTemplates: this.promptTemplates.size,
      totalStrategies: this.promptStrategies.size,
      mostUsedStrategy: 'general_chat' // Would track usage in real implementation
    };
  }
}