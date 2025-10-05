import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Content, Part, FunctionDeclaration, Tool as GeminiTool, SchemaType } from '@google/generative-ai';
import { MCPService } from '../mcp/mcp.service';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

interface ConversationHistory {
  userId: string;
  messages: Content[];
  lastActivity: Date;
}

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;
  private conversationHistory: Map<string, ConversationHistory> = new Map();
  private readonly HISTORY_LIMIT = 20; // Keep last 20 messages per user
  private readonly CLEANUP_INTERVAL = 1000 * 60 * 60; // 1 hour
  private readonly HISTORY_EXPIRY = 1000 * 60 * 60 * 24; // 24 hours

  constructor(
    private configService: ConfigService,
    private mcpService: MCPService,
  ) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.logger.log('✅ Gemini AI initialized');

    // Start cleanup interval for old conversations
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

  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;

    let sanitized = { ...schema };

    // Remove unsupported fields
    delete sanitized.additionalProperties;
    delete sanitized.$schema;
    delete sanitized.default;

    // Handle anyOf/oneOf - take the first option
    if (sanitized.anyOf) {
      sanitized = { ...sanitized, ...sanitized.anyOf[0] };
      delete sanitized.anyOf;
    }
    if (sanitized.oneOf) {
      sanitized = { ...sanitized, ...sanitized.oneOf[0] };
      delete sanitized.oneOf;
    }

    // Recursively sanitize properties
    if (sanitized.properties) {
      const cleanProps: any = {};
      for (const [key, value] of Object.entries(sanitized.properties)) {
        cleanProps[key] = this.sanitizeSchema(value);
      }
      sanitized.properties = cleanProps;
    }

    // Recursively sanitize items (for arrays)
    if (sanitized.items) {
      sanitized.items = this.sanitizeSchema(sanitized.items);
    }

    return sanitized;
  }

  private convertMCPToolsToGemini(mcpTools: Tool[]): GeminiTool[] {
    const functionDeclarations: FunctionDeclaration[] = mcpTools.map(tool => {
      const schema = tool.inputSchema as any;
      const sanitizedSchema = this.sanitizeSchema(schema);
      
      return {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: sanitizedSchema?.properties || {},
          required: sanitizedSchema?.required || [],
        },
      };
    });

    return [{ functionDeclarations }];
  }

  private getUserHistory(userId: string): Content[] {
    const history = this.conversationHistory.get(userId);
    if (!history?.messages) return [];
    
    // Filter out function/tool messages - only keep user and model messages
    // Gemini history must start with 'user' role and alternate user/model
    return history.messages.filter(msg => msg.role === 'user' || msg.role === 'model');
  }

  private addToHistory(userId: string, role: 'user' | 'model', text: string) {
    let history = this.conversationHistory.get(userId);
    
    if (!history) {
      history = {
        userId,
        messages: [],
        lastActivity: new Date(),
      };
      this.conversationHistory.set(userId, history);
    }

    // Only add user and model messages to history (no function calls)
    if (role === 'user' || role === 'model') {
      history.messages.push({
        role,
        parts: [{ text }],
      });

      // Keep only last N messages
      if (history.messages.length > this.HISTORY_LIMIT) {
        history.messages = history.messages.slice(-this.HISTORY_LIMIT);
      }
    }

    history.lastActivity = new Date();
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`[${requestId}] 🤖 Processing message with Gemini for user: ${userId}`);

      // Get available MCP tools
      const mcpTools = await this.mcpService.listTools();
      this.logger.log(`[${requestId}] 🛠️  Loaded ${mcpTools.length} MCP tools`);

      // Convert MCP tools to Gemini format
      const geminiTools = this.convertMCPToolsToGemini(mcpTools);

      // Initialize model with tools and system instruction
      this.model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
        tools: geminiTools,
        systemInstruction: `You're Leo's personal AI assistant - think of yourself as his tech-savvy buddy who handles his digital life.

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
- Keep it scannable

When sending emails:
- ALWAYS actually call the send tool - don't just say you will!
- Confirm after it's done: "Sent! ✅"

🎯 RESPONSE STYLE:
Bad ❌: "I would be delighted to assist you with checking your emails."
Good ✅: "On it! Checking your emails now..."

Bad ❌: "The email has been successfully transmitted to the recipient."
Good ✅: "Sent! ✅"

Bad ❌: "May I have your email address?"
Good ✅: "Gotcha, using l.mangallon@gmail.com"

IMPORTANT: When Leo confirms an action ("yep", "yes", "do it"), IMMEDIATELY execute it with tools. Don't just say you will - actually do it!`,
      });

      // Get conversation history
      const history = this.getUserHistory(userId);
      
      // Start chat with history
      const chat = this.model.startChat({
        history,
      });

      // Send user message
      this.logger.log(`[${requestId}] 💬 Sending to Gemini: "${userMessage}"`);
      let result = await chat.sendMessage(userMessage);
      let response = result.response;

      // Handle function calls (tool execution loop)
      let functionCallCount = 0;
      const MAX_FUNCTION_CALLS = 5;

      while (response.functionCalls() && functionCallCount < MAX_FUNCTION_CALLS) {
        functionCallCount++;
        const functionCalls = response.functionCalls();
        
        this.logger.log(`[${requestId}] 🔧 Function call #${functionCallCount}: ${functionCalls.length} tool(s) to execute`);

        const functionResponses = await Promise.all(
          functionCalls.map(async (call) => {
            this.logger.log(`[${requestId}] ⚙️  Executing tool: ${call.name}`);
            this.logger.log(`[${requestId}] 📝 Arguments: ${JSON.stringify(call.args)}`);

            try {
              const toolResult = await this.mcpService.callTool(call.name, call.args);
              
              this.logger.log(`[${requestId}] ✅ Tool ${call.name} executed successfully`);
              this.logger.log(`[${requestId}] 📊 Result: ${JSON.stringify(toolResult).substring(0, 200)}...`);
              
              return {
                functionResponse: {
                  name: call.name,
                  response: toolResult,
                },
              };
            } catch (error) {
              this.logger.error(`[${requestId}] ❌ Tool ${call.name} failed: ${error.message}`);
              
              return {
                functionResponse: {
                  name: call.name,
                  response: {
                    error: error.message,
                  },
                },
              };
            }
          })
        );

        // Send function results back to Gemini
        result = await chat.sendMessage(functionResponses);
        response = result.response;
      }

      if (functionCallCount >= MAX_FUNCTION_CALLS) {
        this.logger.warn(`[${requestId}] ⚠️  Max function calls (${MAX_FUNCTION_CALLS}) reached`);
      }

      if (functionCallCount === 0 && userMessage.toLowerCase().match(/send|email|schedule|create|add/)) {
        this.logger.warn(`[${requestId}] ⚠️  No tools called but message suggests action needed: "${userMessage}"`);
      }

      // Get final text response
      const finalResponse = response.text();
      this.logger.log(`[${requestId}] 📤 Gemini response: "${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}"`);

      // Save to history
      this.addToHistory(userId, 'user', userMessage);
      this.addToHistory(userId, 'model', finalResponse);

      return finalResponse;

    } catch (error) {
      this.logger.error(`[${requestId}] ❌ Error processing with Gemini:`, error);
      throw new Error(`Failed to process message with Gemini: ${error.message}`);
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