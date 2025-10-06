import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MCPService } from '../mcp/mcp.service';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IAgentService } from './agent.interface';
import { SYSTEM_PROMPT } from './agent.prompts';

interface ConversationHistory {
  userId: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  lastActivity: Date;
}

@Injectable()
export class OpenAIAgentService implements IAgentService, OnModuleInit {
  private readonly logger = new Logger(OpenAIAgentService.name);
  private client: OpenAI;
  private conversationHistory: Map<string, ConversationHistory> = new Map();
  private readonly HISTORY_LIMIT = 20;
  private readonly CLEANUP_INTERVAL = 1000 * 60 * 60; // 1 hour
  private readonly HISTORY_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours

  constructor(
    private configService: ConfigService,
    private mcpService: MCPService,
  ) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in environment variables');
    }

    this.client = new OpenAI({ apiKey });
    this.logger.log('✅ OpenAI client initialized');

    setInterval(() => this.cleanupOldConversations(), this.CLEANUP_INTERVAL);
  }

  private cleanupOldConversations() {
    const now = new Date();
    let cleaned = 0;

    for (const [userId, history] of this.conversationHistory.entries()) {
      const timeDiff = now.getTime() - history.lastActivity.getTime();
      if (timeDiff > this.HISTORY_EXPIRY) {
        this.conversationHistory.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`🧹 Cleaned up ${cleaned} expired conversation(s)`);
    }
  }

  private getUserHistory(userId: string): OpenAI.Chat.ChatCompletionMessageParam[] {
    const history = this.conversationHistory.get(userId);
    return history?.messages || [];
  }

  private addToHistory(userId: string, message: OpenAI.Chat.ChatCompletionMessageParam) {
    let history = this.conversationHistory.get(userId);

    if (!history) {
      history = {
        userId,
        messages: [],
        lastActivity: new Date(),
      };
      this.conversationHistory.set(userId, history);
    }

    history.messages.push(message);

    if (history.messages.length > this.HISTORY_LIMIT) {
      history.messages = history.messages.slice(-this.HISTORY_LIMIT);
    }

    history.lastActivity = new Date();
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
    try {
      this.logger.log(`[${requestId}] 🤖 Processing with OpenAI for user: ${userId}`);

      // Get available MCP tools
      const mcpTools = await this.mcpService.listTools();
      this.logger.log(`[${requestId}] 🛠️  Loaded ${mcpTools.length} MCP tools`);

      // Convert MCP tools to OpenAI format
      const openAITools = this.convertMCPToolsToOpenAI(mcpTools);

      const history = this.getUserHistory(userId);

      // Build messages array for chat completion
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
      
      // Handle tool calls loop (similar to Gemini's function call loop)
      let functionCallCount = 0;
      const MAX_FUNCTION_CALLS = 5;

      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && functionCallCount < MAX_FUNCTION_CALLS) {
        functionCallCount++;
        this.logger.log(`[${requestId}] 🔧 Function call #${functionCallCount}: ${assistantMessage.tool_calls.length} tool(s) to execute`);

        // Add assistant message with tool calls to messages
        messages.push(assistantMessage);

        // Execute each tool call
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

        // Add tool results to messages
        messages.push(...toolResults);

        // Send tool results back to OpenAI
        response = await this.client.chat.completions.create({
          model: 'gpt-4',
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

      // Save to history (only user and final assistant messages, not tool calls)
      this.addToHistory(userId, { role: 'user', content: userMessage });
      this.addToHistory(userId, { role: 'assistant', content: finalResponse });

      return finalResponse;
    } catch (error: any) {
      this.logger.error(`[${requestId}] ❌ Error processing with OpenAI:`, error);
      throw new Error(`Failed to process message with OpenAI: ${error.message}`);
    }
  }

  clearHistory(userId: string) {
    this.conversationHistory.delete(userId);
    this.logger.log(`🗑️  Cleared conversation history for user: ${userId}`);
  }

  getHistoryStats(): { totalUsers: number; totalMessages: number } {
    let totalMessages = 0;
    for (const history of this.conversationHistory.values()) {
      totalMessages += history.messages.length;
    }

    return {
      totalUsers: this.conversationHistory.size,
      totalMessages,
    };
  }
}