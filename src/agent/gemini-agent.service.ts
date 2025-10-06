import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Content, FunctionDeclaration, Tool as GeminiTool, SchemaType } from '@google/generative-ai';
import { MCPService } from '../mcp/mcp.service';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IAgentService } from './agent.interface';
import { SYSTEM_PROMPT } from './agent.prompts';
import { BaseAgentService } from './base-agent.service';

@Injectable()
export class GeminiAgentService extends BaseAgentService<Content> implements IAgentService, OnModuleInit {
  protected readonly logger = new Logger(GeminiAgentService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(
    configService: ConfigService,
    private mcpService: MCPService,
  ) {
    super(configService);
  }

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.logger.log('✅ Gemini AI initialized');

    this.startCleanupInterval();
  }

  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;

    let sanitized = { ...schema };

    delete sanitized.additionalProperties;
    delete sanitized.$schema;
    delete sanitized.default;

    if (sanitized.anyOf) {
      sanitized = { ...sanitized, ...sanitized.anyOf[0] };
      delete sanitized.anyOf;
    }
    if (sanitized.oneOf) {
      sanitized = { ...sanitized, ...sanitized.oneOf[0] };
      delete sanitized.oneOf;
    }

    if (sanitized.properties) {
      const cleanProps: any = {};
      for (const [key, value] of Object.entries(sanitized.properties)) {
        cleanProps[key] = this.sanitizeSchema(value);
      }
      sanitized.properties = cleanProps;
    }

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

  private filterHistoryForGemini(userId: string): Content[] {
    const history = super.getUserHistory(userId);
    return history.filter(msg => msg.role === 'user' || msg.role === 'model');
  }

  private addGeminiMessage(userId: string, role: 'user' | 'model', text: string) {
    if (role === 'user' || role === 'model') {
      super.addToHistory(userId, {
        role,
        parts: [{ text }],
      });
    }
  }

  async processMessage(userId: string, userMessage: string, requestId: string): Promise<string> {
    try {
      this.logger.log(`[${requestId}] 🤖 Processing message with Gemini for user: ${userId}`);

      const mcpTools = await this.mcpService.listTools();
      this.logger.log(`[${requestId}] 🛠️  Loaded ${mcpTools.length} MCP tools`);

      const geminiTools = this.convertMCPToolsToGemini(mcpTools);

      this.model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
        tools: geminiTools,
        systemInstruction: SYSTEM_PROMPT,
      });

      const history = this.filterHistoryForGemini(userId);

      const chat = this.model.startChat({ history });

      this.logger.log(`[${requestId}] 💬 Sending to Gemini: "${userMessage}"`);
      let result = await chat.sendMessage(userMessage);
      let response = result.response;

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
            } catch (error: any) {
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

        result = await chat.sendMessage(functionResponses);
        response = result.response;
      }

      if (functionCallCount >= MAX_FUNCTION_CALLS) {
        this.logger.warn(`[${requestId}] ⚠️  Max function calls (${MAX_FUNCTION_CALLS}) reached`);
      }

      if (functionCallCount === 0 && userMessage.toLowerCase().match(/send|email|schedule|create|add/)) {
        this.logger.warn(`[${requestId}] ⚠️  No tools called but message suggests action needed: "${userMessage}"`);
      }

      const finalResponse = response.text();
      this.logger.log(`[${requestId}] 📤 Gemini response: "${finalResponse.substring(0, 100)}${finalResponse.length > 100 ? '...' : ''}"`);

      this.addGeminiMessage(userId, 'user', userMessage);
      this.addGeminiMessage(userId, 'model', finalResponse);

      return finalResponse;

    } catch (error: any) {
      this.logger.error(`[${requestId}] ❌ Error processing with Gemini:`, error);
      throw new Error(`Failed to process message with Gemini: ${error.message}`);
    }
  }
}