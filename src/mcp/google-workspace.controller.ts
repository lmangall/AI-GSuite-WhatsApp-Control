import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { GoogleWorkspaceMCPService } from './google-workspace-mcp.service';

type ToolResponse = any; // Replace with proper type from your SDK

/**
 * Google Workspace Controller
 * Handles HTTP requests for Google Workspace MCP operations
 * Supports Gmail, Calendar, Docs, Sheets, Slides, Chat, Forms, Tasks, Search & Drive
 */
@Controller('google-workspace')
export class GoogleWorkspaceController {
  constructor(private readonly googleWorkspaceService: GoogleWorkspaceMCPService) {}

  // GET endpoint for simple Google Workspace tool queries
  @Get('call')
  async callToolGet(
    @Query('name') name: string,
  ): Promise<ToolResponse | { error: string }> {
    if (!name) return { error: 'Google Workspace tool name is required' };
    return this.googleWorkspaceService.callTool(name);
  }

  // POST endpoint for Google Workspace operations with full JSON body
  @Post()
  async callToolPost(@Body() body: { name: string; args?: any }): Promise<ToolResponse> {
    if (!body.name) throw new Error('Google Workspace tool name is required');
    return this.googleWorkspaceService.callTool(body.name, body.args);
  }
}
