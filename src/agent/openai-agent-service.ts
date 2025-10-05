import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MCPService } from '../mcp/mcp.service';
import { IAgentService } from './agent.interface';

interface ConversationHistory {
  userId: string;
  messages: { role: string; content: string }[];
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

  private getUserHistory(userId: string) {
    const history = this.conversationHistory.get(userId);
    return history?.messages || [];
  }

  private addToHistory(userId: string, message: { role: string; content: string }) {
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

      // Convert chat messages to OpenAI Responses input format
      const input = [
        {
          type: 'input_text',
          text: `You're Leo's personal AI assistant - think of yourself as his tech-savvy buddy who handles his digital life.

🎭 VIBE:
- Super casual, like texting a friend
- Use "dude", "bro", "mate" occasionally 
- Short responses when possible
- Skip formalities - no "I apologize" or "I would be happy to"

🧠 WHAT YOU KNOW ABOUT LEO:
- Name: Leonardo (goes by Leo)
- Email: l.mangallon@gmail.com
- NEVER ask for these again - you already know them!

📧 EMAIL HANDLING:
When showing emails:
- Format: "📧 [Subject] - from [Sender]"
- NO message IDs unless specifically asked

When sending emails:
- ALWAYS actually call the send tool - don't just say you will!
- Confirm after it's done: "Sent! ✅"

🎯 RESPONSE STYLE:
Bad ❌: "I would be delighted to assist you with checking your emails."
Good ✅: "On it! Checking your emails now..."

IMPORTANT: When Leo confirms an action ("yep", "yes", "do it"), IMMEDIATELY execute it with tools. Don't just say you will - actually do it!`,
        },
        ...history.map((msg) => ({
          type: 'input_text',
          text: `${msg.role === 'user' ? 'User: ' : 'Assistant: '}${msg.content}`,
        })),
        { type: 'input_text', text: userMessage },
      ];

      this.logger.log(`[${requestId}] 💬 Sending to OpenAI: "${userMessage}"`);

      const response = await this.client.responses.create({
        model: 'gpt-5-nano',
        tools: [
          {
            type: 'mcp',
            server_label: 'gmail_calendar',
            server_url: this.mcpServerUrl,
            require_approval: 'never',
          },
        ],
        input,
      });

      // Log MCP tool listings
      const mcpListItems = response.output.filter((item: any) => item.type === 'mcp_list_tools');
      if (mcpListItems.length > 0) {
        mcpListItems.forEach((item: any) => {
          this.logger.log(`[${requestId}] 🛠️  Listed ${item.tools?.length || 0} MCP tools`);
        });
      }

      // Log MCP tool calls
      const mcpCalls = response.output.filter((item: any) => item.type === 'mcp_call');
      if (mcpCalls.length > 0) {
        this.logger.log(`[${requestId}] 🔧 Executed ${mcpCalls.length} tool call(s)`);
        mcpCalls.forEach((call: any) => {
          this.logger.log(`[${requestId}] ⚙️  Tool: ${call.name}`);
          this.logger.log(`[${requestId}] 📝 Args: ${JSON.stringify(call.arguments)}`);
          if (call.error) {
            this.logger.error(`[${requestId}] ❌ Error: ${call.error}`);
          } else {
            this.logger.log(`[${requestId}] ✅ Success`);
          }
        });
      }

      const finalResponse = response.output_text;
      this.logger.log(
        `[${requestId}] 📤 OpenAI response: "${finalResponse.substring(0, 100)}${
          finalResponse.length > 100 ? '...' : ''
        }"`,
      );

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
