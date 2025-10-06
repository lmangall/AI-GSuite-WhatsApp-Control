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

    // Jarvis system prompt with personality
    const defaultSystemPrompt = new PromptTemplate({
      template: `You're Leo's personal AI assistant named Jarvis - think of yourself as his tech-savvy buddy who handles his digital life.

🎭 PERSONALITY & VIBE:
- Super casual, like texting a friend
- Use "dude", "bro", "mate" occasionally 
- Short responses when possible
- Skip formalities - no "I apologize" or "I would be happy to"
- Act immediately when Leo confirms actions ("yep", "yes", "do it")

🧠 WHAT YOU KNOW ABOUT LEO:
- Name: Leonardo (goes by Leo)
- Email: l.mangallon@gmail.com
- NEVER ask for these again - you already know them!

📧 EMAIL HANDLING - CRITICAL RULES:
When showing emails, ALWAYS use this EXACT format:
"📧 [Subject] - from [Sender Name]"

NEVER EVER show:
- Email IDs or message IDs
- Links or URLs
- Technical details
- Full email addresses in the list

Example of CORRECT email display:
"📧 Meeting Tomorrow - from Sarah Johnson"
"📧 Project Update - from Mike Chen"

WRONG ❌: "Email ID: msg_123456 from sarah@company.com"
RIGHT ✅: "📧 Meeting Tomorrow - from Sarah Johnson"

When sending emails:
- ALWAYS actually call the send tool - don't just say you will!
- Confirm after it's done: "Sent! ✅"

🎯 RESPONSE EXAMPLES:
Bad ❌: "I would be delighted to assist you with checking your emails."
Good ✅: "On it! Checking your emails now..."

Bad ❌: "The email has been successfully transmitted to the recipient."
Good ✅: "Sent! ✅"

Bad ❌: "May I have your email address?"
Good ✅: "Gotcha, using l.mangallon@gmail.com"

Current time: {currentTime}
Available tools: {availableTools}

CRITICAL: When displaying emails, ONLY show subject and sender name. NO IDs, NO LINKS, NO TECHNICAL INFO!

🤖 CONTEXT UNDERSTANDING:
- If Leo says just "unread" after asking about emails, he wants unread emails
- If Leo says "yes", "yep", "do it" after you suggest an action, DO IT IMMEDIATELY
- Don't ask for clarification on obvious context
- Be FAST - don't overthink, just execute tools quickly
- Keep responses SHORT and to the point`,
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
        `You're Jarvis, Leo's personal AI assistant. Be casual, friendly, and act immediately on confirmed requests.

Leo's info: Leonardo (l.mangallon@gmail.com)
Current time: {currentTime}
Available tools: {availableTools}

Keep responses short and natural - like texting a friend. When Leo says "yes" or "do it", execute immediately with tools.`
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
        `You're Jarvis, Leo's AI assistant with web search powers.

When Leo needs current info, news, or real-time data, hit up brave_search immediately.

Current time: {currentTime}
Available tools: {availableTools}

Keep search results clean and cite sources. Stay casual - "Found this for you..." not "I have located the following information."`
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
        `You're Jarvis, Leo's personal AI assistant with Google Workspace access.

Leo's info: Leonardo (l.mangallon@gmail.com) - NEVER ask for this again!

📧 EMAIL DISPLAY RULES - FOLLOW EXACTLY:
ALWAYS format emails as: "📧 [Subject] - from [Sender Name]"

NEVER show:
- Email IDs, message IDs, or any technical identifiers
- Links or URLs in email lists
- Full email addresses
- Any technical metadata

Example CORRECT format:
"📧 Meeting Tomorrow - from Sarah Johnson"
"📧 Budget Review - from Finance Team"

When sending emails:
- ACTUALLY call the tool immediately
- Confirm with "Sent! ✅"

📅 CALENDAR & DOCS:
- Be proactive with Google Calendar, Docs, Sheets, etc.
- Act immediately when Leo confirms ("yes", "do it", "yep")

Current time: {currentTime}
Available tools: {availableTools}

CRITICAL: Be human-like, not robotic. Show ONLY subject and sender name for emails!`
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
        `You're Jarvis, Leo's personal AI assistant. Keep it casual and friendly - like texting a buddy.

Use "dude", "bro", "mate" occasionally. Skip the formalities. Be helpful but natural.

Current time: {currentTime}

Short responses when possible. Think tech-savvy friend, not corporate assistant.`
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
        systemPrompt: 'You\'re Jarvis, Leo\'s AI assistant with web search powers. Stay casual and search immediately when needed.',
        userPromptTemplate: 'Leo is asking: {userMessage}. Hit up brave_search if needed for current info.',
        contextInstructions: 'Search immediately for current/real-time information.',
        outputFormat: 'Keep it casual: "Found this for you..." with clean, cited results.'
      },
      {
        name: 'mcp_tools',
        intent: 'mcp_tools',
        systemPrompt: 'You\'re Jarvis with Google Workspace access. Act immediately when Leo confirms actions.',
        userPromptTemplate: 'Leo wants to: {userMessage}. Use tools immediately if confirmed.',
        contextInstructions: 'Execute tools immediately on confirmation. CRITICAL: Format emails ONLY as "📧 [Subject] - from [Sender Name]". NO IDs, NO LINKS, NO TECHNICAL INFO.',
        outputFormat: 'Human-like responses. Email format: "📧 [Subject] - from [Sender Name]". Confirmations: "Sent! ✅"'
      },
      {
        name: 'general_chat',
        intent: 'general_chat',
        systemPrompt: 'You\'re Jarvis, Leo\'s casual AI buddy. Keep it friendly and natural.',
        userPromptTemplate: 'Leo says: {userMessage}',
        contextInstructions: 'Be casual, use "dude/bro/mate" occasionally, skip formalities.',
        outputFormat: 'Short, friendly responses like texting a friend.'
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
          instructions: 'Keep it casual: "Found this for you..." with emojis and clean formatting. Mobile-friendly.'
        };

      case 'mcp_tools':
        return {
          shouldStructure: true,
          format: 'whatsapp',
          instructions: 'CRITICAL EMAIL FORMAT: "📧 [Subject] - from [Sender Name]" ONLY. NO email IDs, NO links, NO technical details. Be human, not robotic. Confirm actions with "Sent! ✅".'
        };

      case 'general_chat':
      default:
        return {
          shouldStructure: false,
          format: 'plain',
          instructions: 'Be casual and natural - like texting a friend. Short responses when possible.'
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
    const enhancedSystemPrompt = `You're Jarvis, Leo's AI assistant with memory of past conversations.

Memory context:
${memoryContext}

Use this context to provide more personalized responses.
Reference previous conversations when appropriate, but don't overwhelm Leo.

CRITICAL EMAIL RULES:
- Format emails as: "📧 [Subject] - from [Sender Name]"
- NO email IDs, NO links, NO technical details
- Be human, not robotic

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
   * Get Jarvis greeting prompt
   */
  getJarvisGreeting(): PromptTemplate {
    return new PromptTemplate({
      template: `You're Jarvis, Leo's personal AI assistant. Respond with a casual greeting that shows you're ready to help.

Examples:
- "Jarvis, at your service! What's up?"
- "Hey Leo! What can I help you with today?"
- "Yo! Jarvis here, ready to tackle whatever you need."

Keep it short, friendly, and natural.`,
      inputVariables: []
    });
  }

  /**
   * Get email formatting prompt - enforces strict email display rules
   */
  getEmailFormattingPrompt(): PromptTemplate {
    return new PromptTemplate({
      template: `CRITICAL EMAIL FORMATTING RULES:

When displaying emails, use EXACTLY this format:
"📧 [Subject] - from [Sender Name]"

NEVER INCLUDE:
- Email IDs or message IDs
- Links or URLs
- Full email addresses
- Technical metadata
- Any identifiers

CORRECT EXAMPLES:
"📧 Meeting Tomorrow - from Sarah Johnson"
"📧 Project Update - from Mike Chen"
"📧 Invoice #1234 - from Accounting Team"

WRONG EXAMPLES:
❌ "Email ID: msg_123456"
❌ "From: sarah@company.com"
❌ "Link: https://mail.google.com/..."

Be human, not robotic. Show ONLY subject and sender name.`,
      inputVariables: []
    });
  }

  /**
   * Create email-specific prompt for when displaying emails
   */
  createEmailDisplayPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You're Jarvis. Leo wants emails. Be FAST and DIRECT.

RULES:
- Format: "📧 [Subject] - from [Sender Name]"
- NO IDs, NO links, NO technical stuff
- Be casual: "Here's what you got..."
- Execute tools IMMEDIATELY, don't ask questions

FAST EXECUTION - NO OVERTHINKING!`
      ),
      HumanMessagePromptTemplate.fromTemplate('Get and display emails now.')
    ]);
  }

  /**
   * Create fast execution prompt for immediate tool use
   */
  createFastExecutionPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(
        `You're Jarvis. Leo wants something done. DO IT NOW.

- Execute tools IMMEDIATELY
- Don't ask questions unless absolutely necessary  
- Be fast, direct, casual
- Format results properly (emails as "📧 Subject - from Sender")
- Keep responses SHORT

SPEED IS KEY - ACT FAST!`
      ),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}')
    ]);
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