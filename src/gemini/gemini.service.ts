import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Content, Part, FunctionDeclaration, Tool as GeminiTool } from '@google/generative-ai';
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

  private convertMCPToolsToGemini(mcpTools: Tool[]): GeminiTool[] {
    const functionDeclarations: FunctionDeclaration[] = mcpTools.map(tool => {
      const schema = tool.inputSchema as any;
      
      return {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        parameters: {
          type: 'object',
          properties: schema?.properties || {},
          required: schema?.required || [],
        },
      };
    });

    return [{ functionDeclarations }];
  }

  private getUserHistory(userId: string): Content[] {
    const history = this.conversationHistory.get(userId);
    return history?.messages || [];
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

    history.messages.push({
      role,
      parts: [{ text }],
    });

    // Keep only last N messages
    if (history.messages.length > this.HISTORY_LIMIT) {
      history.messages = history.messages.slice(-this.HISTORY_LIMIT);
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

      // Initialize model with tools
      this.model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
        tools: geminiTools,
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