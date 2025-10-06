# Google Workspace MCP Integration

This module provides AI control over Google Workspace services through the Model Context Protocol (MCP).

## Supported Google Workspace Services

- **Gmail** - Send, read, and manage emails
- **Google Calendar** - Create, update, and manage calendar events
- **Google Docs** - Create and edit documents
- **Google Sheets** - Create and manipulate spreadsheets
- **Google Slides** - Create and edit presentations
- **Google Chat** - Send messages and manage conversations
- **Google Forms** - Create and manage forms
- **Google Tasks** - Manage task lists and items
- **Google Search** - Perform searches across Google services
- **Google Drive** - Manage files and folders

## Configuration

Set the Google Workspace MCP server URL in your environment:

```bash
GOOGLE_WORKSPACE_MCP_SERVER_URL=http://localhost:3001
```

## Usage

The service automatically connects to the Google Workspace MCP server on module initialization and provides tools for AI agents to interact with Google Workspace services.

### Available Endpoints

- `GET /google-workspace/call?name=<tool_name>` - Execute a Google Workspace tool
- `POST /google-workspace` - Execute a Google Workspace tool with arguments

### Example Tool Calls

```typescript
// List available Google Workspace tools
const tools = await googleWorkspaceService.listTools();

// Send an email via Gmail
const result = await googleWorkspaceService.callTool('gmail_send', {
  to: 'user@example.com',
  subject: 'Hello from AI',
  body: 'This email was sent by an AI assistant'
});

// Create a calendar event
const event = await googleWorkspaceService.callTool('calendar_create_event', {
  title: 'AI Meeting',
  start: '2024-01-15T10:00:00Z',
  end: '2024-01-15T11:00:00Z'
});
```

## Architecture

- **GoogleWorkspaceMCPService** - Core service for MCP communication
- **GoogleWorkspaceController** - HTTP endpoints for external access
- **GoogleWorkspaceModule** - NestJS module configuration

## Error Handling

The service includes comprehensive error handling and logging for:
- Connection failures to the MCP server
- Tool execution errors
- Invalid tool arguments
- Network timeouts

## Logging

All operations are logged with appropriate levels:
- Connection status
- Tool execution results
- Error details with context