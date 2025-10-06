import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MCPService } from '../mcp/mcp.service';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IAgentService } from './agent.interface';
import { SYSTEM_PROMPT } from './agent.prompts';
import { BaseAgentService } from './base-agent.service';

@Injectable()
export class OpenAIAgentService extends BaseAgentService<OpenAI.Chat.ChatCompletionMessageParam> implements IAgentService, OnModuleInit {
  protected readonly logger = new Logger(OpenAIAgentService.name);
  private client: OpenAI;

  constructor(
    configService: ConfigService,
    private mcpService: MCPService,
  ) {
    super(configService);
  }

  async onModuleInit() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in environment variables');
    }

    this.client = new OpenAI({ apiKey });
    this.logger.log('✅ OpenAI client initialized');

    this.startCleanupInterval();
  }

  private needsWebSearch(message: string): boolean {
    const webSearchKeywords = [
      'news', 'latest', 'current', 'today', 'recent', 'now',
      'weather', 'stock', 'price', 'what happened', 'update on',
      'search for', 'look up', 'find information', 'google'
    ];

    const lowerMessage = message.toLowerCase();
    return webSearchKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private convertMCPToolsToOpenAI(mcpTools: Tool[]): OpenAI.Chat.ChatCompletionTool[] {
    return mcpTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    }));
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    // Check if web search is needed
    if (this.needsWebSearch(userMessage)) {
      return this.processWithWebSearch(userId, userMessage, requestId);
    }

    return this.processWithChatCompletion(userId, userMessage, requestId);
  }

  private async processWithWebSearch(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`[${requestId}] 🌐 Processing with web search for user: ${userId}`);

      // For now, fall back to regular chat completion since web_search tool is not available
      // In a real implementation, you would integrate with a web search service
      this.logger.warn(`[${requestId}] ⚠️ Web search requested but not available, using regular chat`);

      return this.processWithChatCompletion(userId, userMessage, requestId);
    } catch (error: any) {
      this.logger.error(`[${requestId}] ❌ Error with web search, falling back to chat: ${error.message}`);
      return this.processWithChatCompletion(userId, userMessage, requestId);
    }
  }

  private async processWithChatCompletion(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`[${requestId}] 🤖 Processing with OpenAI for user: ${userId}`);

      const mcpTools = await this.mcpService.listTools();
      this.logger.log(`[${requestId}] 🛠️  Loaded ${mcpTools.length} MCP tools`);

      const openAITools = this.convertMCPToolsToOpenAI(mcpTools);

      const history = this.getUserHistory(userId);

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userMessage },
      ];

      this.logger.log(`[${requestId}] 💬 Sending to OpenAI: "${userMessage}"`);

      let response = await this.client.chat.completions.create({
        model: 'gpt-5-nano',
        messages: messages,
        tools: openAITools,
      });

      let assistantMessage = response.choices[0].message;

      let functionCallCount = 0;
      const MAX_FUNCTION_CALLS = 5;

      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && functionCallCount < MAX_FUNCTION_CALLS) {
        functionCallCount++;
        this.logger.log(`[${requestId}] 🔧 Function call #${functionCallCount}: ${assistantMessage.tool_calls.length} tool(s) to execute`);

        messages.push(assistantMessage);

        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall) => {
            this.logger.log(`[${requestId}] ⚙️  Executing tool: ${toolCall.function.name}`);
            this.logger.log(`[${requestId}] 📝 Arguments: ${toolCall.function.arguments}`);

            try {
              const args = JSON.parse(toolCall.function.arguments);
              const toolResult = await this.mcpService.callTool(toolCall.function.name, args);

              this.logger.log(`[${requestId}] ✅ Tool ${toolCall.function.name} executed successfully`);
              this.logger.log(`[${requestId}] 📊 Result: ${JSON.stringify(toolResult).substring(0, 200)}...`);

              return {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                content: JSON.stringify(toolResult),
              };
            } catch (error: any) {
              this.logger.error(`[${requestId}] ❌ Tool ${toolCall.function.name} failed: ${error.message}`);

              return {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                content: JSON.stringify({ error: error.message }),
              };
            }
          })
        );

        messages.push(...toolResults);

        response = await this.client.chat.completions.create({
          model: 'gpt-5-nano',
          messages: messages,
          tools: openAITools,
        });

        assistantMessage = response.choices[0].message;
      }

      if (functionCallCount >= MAX_FUNCTION_CALLS) {
        this.logger.warn(`[${requestId}] ⚠️  Max function calls (${MAX_FUNCTION_CALLS}) reached`);
      }

      if (functionCallCount === 0 && userMessage.toLowerCase().match(/send|email|schedule|create|add|list/)) {
        this.logger.warn(`[${requestId}] ⚠️  No tools called but message suggests action needed: "${userMessage}"`);
      }

      const finalResponse = assistantMessage.content || 'No response generated';
      this.logger.log(`[${requestId}] 📤 OpenAI response: "${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}"`);

      this.addToHistory(userId, { role: 'user', content: userMessage });
      this.addToHistory(userId, { role: 'assistant', content: finalResponse });

      return finalResponse;
    } catch (error: any) {
      this.logger.error(`[${requestId}] ❌ Error processing with OpenAI:`, error);
      throw new Error(`Failed to process message with OpenAI: ${error.message}`);
    }
  }
}