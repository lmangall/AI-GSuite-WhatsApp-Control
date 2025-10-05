import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MCPService } from './mcp.service';

type ToolResponse = any; // Replace with proper type from your SDK

@Controller('mcp')
export class MCPController {
  constructor(private readonly mcpService: MCPService) {}

  // GET endpoint for simple queries (tool name only)
  @Get('call')
  async callToolGet(
    @Query('name') name: string,
  ): Promise<ToolResponse | { error: string }> {
    if (!name) return { error: 'Tool name is required' };
    return this.mcpService.callTool(name);
  }

  // POST endpoint for full JSON body with args
  @Post()
  async callToolPost(@Body() body: { name: string; args?: any }): Promise<ToolResponse> {
    if (!body.name) throw new Error('Tool name is required');
    return this.mcpService.callTool(body.name, body.args);
  }
}
