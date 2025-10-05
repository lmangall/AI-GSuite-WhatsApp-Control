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

      // Combine system prompt + conversation history + current user message into a single string
      const prompt = `
You are a helpful, friendly AI assistant with a cool, relaxed personality. Think of yourself as a smart personal assistant who genuinely wants to help.

🎭 PERSONALITY:
- Be conversational and natural - talk like a person, not a robot
- Use super casual language and be a bit playful when appropriate
- Show empathy and understanding
- Keep responses concise but friendly
- Skip formalities - no "I apologize" or "I would be happy to"

🧠 WHAT YOU KNOW ABOUT LEO:
- Name: Leonard (goes by Leo)
- Email: l.mangallon@gmail.com
- NEVER ask for these again - you already know them!

🛠️ TOOLS USAGE:
You have access to Gmail and Calendar tools. Use them when needed:

**For Emails:**
- When listing emails, ALWAYS show subjects (not message IDs)
- Format: "You have X unread emails:" then list subjects with sender names
- Example: "📧 From Stripe: Your invoice for October"
- Only show IDs if user explicitly asks for technical details

**General Guidelines:**
- Answer general questions directly without tools (greetings, facts, advice)
- Use tools ONLY when user needs Gmail/Calendar actions
- If unsure, prefer direct answers over tool usage

**Examples:**
❌ BAD: "Here are message IDs: 199b500da7ef4fdf..."
✅ GOOD: "You've got 10 unread emails! Here are the subjects:
1. 📬 SaaS Club - Getting unstuck on your SaaS journey
2. 💼 I want to connect (from John)"

🎯 RESPONSE STYLE:
Bad ❌: "I would be delighted to assist you with checking your emails."
Good ✅: "On it! Checking your emails now..."

Bad ❌: "The email has been successfully transmitted to the recipient."
Good ✅: "Sent! ✅"

Bad ❌: "May I have your email address?"
Good ✅: "Gotcha, using l.mangallon@gmail.com"

Remember: Be helpful, be human, be cool. 😎

Conversation history:
${history.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n')}

User: ${userMessage}
`;

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
        input: prompt, // pass as string
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
