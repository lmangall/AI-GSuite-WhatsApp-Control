import { Module } from '@nestjs/common';
import { GoogleWorkspaceMCPService } from './google-workspace-mcp.service';
import { GoogleWorkspaceController } from './google-workspace.controller';

/**
 * Google Workspace MCP Module
 * Provides integration with Google Workspace services:
 * Gmail, Calendar, Docs, Sheets, Slides, Chat, Forms, Tasks, Search & Drive
 */
@Module({
  controllers: [GoogleWorkspaceController],
  providers: [GoogleWorkspaceMCPService],
  exports: [GoogleWorkspaceMCPService],
})
export class GoogleWorkspaceModule {}