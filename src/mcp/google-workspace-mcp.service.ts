import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { 
  CallToolRequest, 
  CallToolResultSchema,
  ListToolsResultSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';

type ToolResponse = any;

/**
 * Google Workspace MCP Service
 * Provides AI control over Gmail, Google Calendar, Docs, Sheets, Slides, 
 * Chat, Forms, Tasks, Search & Drive through MCP protocol
 */
@Injectable()
export class GoogleWorkspaceMCPService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleWorkspaceMCPService.name);
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private serverUrl: string;
  private sessionId?: string;

  constructor(private configService: ConfigService) {
    this.serverUrl = this.configService.get<string>('GOOGLE_WORKSPACE_MCP_SERVER_URL');
    if (!this.serverUrl) {
      throw new Error('GOOGLE_WORKSPACE_MCP_SERVER_URL is not defined in environment variables');
    }
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    this.logger.log(`Connecting to MCP server at ${this.serverUrl}...`);

    try {
      this.client = new Client(
        { name: 'google-workspace-mcp-client', version: '1.0.0' },
        { capabilities: { elicitation: {} } }
      );

      this.transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
        sessionId: this.sessionId,
      });

      this.client.onerror = (err) => this.logger.error('Client error:', err);

      await this.client.connect(this.transport);
      this.sessionId = this.transport.sessionId;

      this.logger.log(`✅ Connected to MCP server, session ID: ${this.sessionId}`);
    } catch (error) {
      this.logger.error('Failed to connect to MCP server:', error);
      throw new Error(`Failed to connect to MCP server: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client || !this.transport) return;
    
    try {
      await this.transport.close();
      this.logger.log('Disconnected from MCP server');
    } catch (error) {
      this.logger.error('Error disconnecting from MCP server:', error);
      throw new Error(`Error disconnecting from MCP server: ${error.message}`);
    }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    try {
      this.logger.debug('Listing available tools...');
      
      const result = await this.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
      );
      
      this.logger.debug(`Found ${result.tools.length} tools`);
      return result.tools;
    } catch (error) {
      this.logger.error('Error listing tools:', error);
      throw new Error(`Failed to list tools: ${error.message}`);
    }
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
    if (!this.client) {
      throw new Error('Not connected to MCP server');
    }

    try {
      const request: CallToolRequest = {
        method: 'tools/call',
        params: { name, arguments: args },
      };
      
      this.logger.debug(`Calling tool: ${name}`, { args });
      const result = await this.client.request(request, CallToolResultSchema);
      this.logger.debug(`Tool ${name} result:`, { result });
      
      return result as ToolResponse;
    } catch (error) {
      this.logger.error(`Error calling tool ${name}:`, error);
      throw new Error(`Failed to call tool ${name}: ${error.message}`);
    }
  }
}