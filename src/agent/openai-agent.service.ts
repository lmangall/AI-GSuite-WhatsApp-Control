import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MCPService } from '../mcp/mcp.service';
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
  private mcpServerUrl: string;

  constructor(
    private configService: ConfigService,
    private mcpService: MCPService,
  ) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined in environment variables');
    }

    this.mcpServerUrl = this.configService.get<string>('MCP_SERVER_URL');
    if (!this.mcpServerUrl) {
      throw new Error('MCP_SERVER_URL is not defined in environment variables');
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

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`[${requestId}] 🤖 Processing with OpenAI for user: ${userId}`);

      const history = this.getUserHistory(userId);

      // Build messages array for chat completion
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: userMessage },
      ];

      this.logger.log(`[${requestId}] 💬 Sending to OpenAI: "${userMessage}"`);

      const response = await this.client.chat.completions.create({
        model: 'gpt-5-nano',
        messages: messages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'mcp_tool',
              description: 'Execute MCP server tools',
              parameters: {
                type: 'object',
                properties: {
                  tool_name: {
                    type: 'string',
                    description: 'Name of the MCP tool to execute',
                  },
                  arguments: {
                    type: 'object',
                    description: 'Arguments to pass to the tool',
                  },
                },
                required: ['tool_name', 'arguments'],
              },
            },
          },
        ],
      });

      const assistantMessage = response.choices[0].message;
      
      // Handle tool calls if present
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        this.logger.log(`[${requestId}] 🔧 Executed ${assistantMessage.tool_calls.length} tool call(s)`);
        
        for (const toolCall of assistantMessage.tool_calls) {
          this.logger.log(`[${requestId}] ⚙️  Tool: ${toolCall.function.name}`);
          this.logger.log(`[${requestId}] 📝 Args: ${toolCall.function.arguments}`);
        }
      }

      const finalResponse = assistantMessage.content || 'No response generated';
      this.logger.log(`[${requestId}] 📤 OpenAI response: "${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}"`);

      // Save to history
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