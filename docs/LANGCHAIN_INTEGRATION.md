# LangChain Integration Documentation

## Overview

This document describes the LangChain.js integration for the NestJS WhatsApp AI control application. The integration enhances AI agent capabilities with advanced prompt engineering, memory management, and tool orchestration.

## Architecture

### Core Components

1. **LangChain Agent Service** - Main orchestrator using LangChain patterns
2. **Memory Manager** - Handles conversation memory and context
3. **Tool Manager** - Manages MCP and Brave search tools
4. **Prompt Manager** - Handles prompt templates and strategies
5. **Agent Executor** - Executes agents with tool integration
6. **Intent Detection** - Routes messages based on detected intent
7. **Circuit Breaker** - Provides resilience and fallback mechanisms
8. **Monitoring** - Comprehensive health checks and metrics
9. **Structured Logging** - Enhanced logging for observability

### Integration Flow

```
WhatsApp Message → Agent Factory → LangChain Agent → Intent Detection → Agent Executor
                                                                            ↓
                                    Memory ← Prompt Manager ← Tool Manager ← Tools (MCP, Brave)
```

## Configuration

### Environment Variables

Copy `config/langchain.example.env` to `.env` and configure the following:

#### Core Configuration
- `USE_LANGCHAIN=true` - Enable LangChain integration
- `LANGCHAIN_DEFAULT_MODEL=gemini` - Primary AI model
- `LANGCHAIN_FALLBACK_MODEL=openai` - Fallback AI model
- `LANGCHAIN_MEMORY_TYPE=conversation` - Memory strategy
- `LANGCHAIN_MAX_TOKENS=4000` - Maximum tokens per response

#### API Keys
- `GEMINI_API_KEY` - Google Gemini API key
- `OPENAI_API_KEY` - OpenAI API key
- `BRAVE_SEARCH_API_KEY` - Brave Search API key

#### Tool Configuration
- `LANGCHAIN_ENABLED_TOOLS=mcp,brave_search` - Enabled tools
- `LANGCHAIN_TOOL_TIMEOUT=30000` - Tool execution timeout
- `MCP_SERVER_URL=http://localhost:3001` - MCP server URL

### Prompt Configuration

Custom prompts can be configured using:
- `LANGCHAIN_SYSTEM_PROMPT_PATH` - Path to system prompt file
- `LANGCHAIN_PROMPT_TEMPLATES_PATH` - Path to prompt templates directory

Example prompt files are provided in `config/prompts/`.

## Features

### Intent Detection

The system automatically detects user intent and routes messages appropriately:

- **Web Search Intent** - For current information, news, real-time data
- **MCP Tools Intent** - For productivity tasks (email, calendar, documents)
- **General Chat Intent** - For conversational interactions

### Memory Management

- **Conversation Buffer Memory** - Maintains recent conversation history
- **Context Summarization** - Automatically summarizes when token limits are exceeded
- **User-specific Memory** - Isolated memory per user
- **Memory Cleanup** - Automatic cleanup of expired conversations

### Tool Integration

#### Brave Search Tool
- Web search for current information
- Query optimization and result formatting
- WhatsApp-friendly response formatting

#### MCP Tools
- Automatic discovery of available MCP tools
- Schema validation and conversion to LangChain format
- Error handling and retry logic

### Circuit Breaker Pattern

Provides resilience with automatic fallback:
- **Model Execution** - Falls back to alternative models
- **Tool Execution** - Graceful degradation when tools fail
- **Agent Execution** - Falls back to legacy agents when needed

### Monitoring and Observability

#### Health Checks
- Component health monitoring
- Automatic health status reporting
- Performance metrics collection

#### Structured Logging
- Comprehensive event logging
- Performance metrics
- Business metrics
- Security event logging

#### Metrics Export
- Prometheus-compatible metrics
- Dashboard data export
- Real-time monitoring support

## Usage

### Basic Usage

The integration is transparent to existing code. Messages are processed through the Agent Factory Service, which automatically uses LangChain when enabled.

```typescript
// Existing code continues to work
const response = await agentFactoryService.processMessage(userId, message, requestId);
```

### Intent-based Processing

For explicit intent-based processing:

```typescript
const response = await agentFactoryService.processMessageWithIntent(userId, message, requestId);
```

### Health Monitoring

```typescript
// Get health status
const health = await monitoringService.getHealthStatus();

// Get metrics
const metrics = await monitoringService.collectMetrics();

// Get circuit breaker status
const circuitStatus = agentFactoryService.getCircuitBreakerStatus();
```

## Deployment

### Development

1. Copy `config/langchain.example.env` to `.env`
2. Configure API keys and settings
3. Start the application: `npm run start:dev`

### Production

1. Set environment variables in your deployment environment
2. Ensure all required API keys are configured
3. Monitor health endpoints for system status
4. Set up log aggregation for structured logs

### Docker

```dockerfile
# Add to your Dockerfile
COPY config/ /app/config/
ENV USE_LANGCHAIN=true
```

## Troubleshooting

### Common Issues

#### Configuration Errors
- Check that all required API keys are set
- Verify MCP server URL is accessible
- Ensure tool configurations are valid

#### Model Failures
- Check API key validity and quotas
- Monitor circuit breaker status
- Verify fallback model configuration

#### Tool Execution Issues
- Check MCP server connectivity
- Verify Brave Search API key
- Monitor tool execution logs

#### Memory Issues
- Check memory cleanup configuration
- Monitor memory usage metrics
- Adjust token limits if needed

### Debugging

Enable detailed logging:
```env
LANGCHAIN_ENABLE_TRACING=true
LANGCHAIN_ENABLE_METRICS=true
```

Check health status:
```bash
curl http://localhost:3000/health/langchain
```

### Performance Tuning

#### Memory Optimization
- Adjust `LANGCHAIN_MEMORY_EXPIRY_HOURS`
- Tune `LANGCHAIN_MAX_TOKENS`
- Monitor memory usage metrics

#### Tool Performance
- Adjust `LANGCHAIN_TOOL_TIMEOUT`
- Limit `LANGCHAIN_MAX_TOOL_CALLS`
- Monitor tool execution times

#### Circuit Breaker Tuning
- Adjust failure thresholds
- Tune recovery timeouts
- Monitor circuit breaker events

## Migration Guide

### From Legacy Agents

1. Set `USE_LANGCHAIN=true` in environment
2. Configure LangChain-specific settings
3. Test with a subset of users
4. Monitor performance and error rates
5. Gradually increase traffic to LangChain

### Rollback Plan

1. Set `USE_LANGCHAIN=false`
2. Monitor legacy agent performance
3. Investigate and fix LangChain issues
4. Re-enable when ready

## API Reference

### Agent Factory Service

```typescript
interface AgentFactoryService {
  processMessage(userId: string, message: string, requestId: string): Promise<string>;
  processMessageWithIntent(userId: string, message: string, requestId: string): Promise<string>;
  getAgentHealthStatus(): Promise<HealthStatus>;
  getCurrentProviderInfo(): ProviderInfo;
  getCircuitBreakerStatus(): CircuitBreakerStats;
}
```

### Monitoring Service

```typescript
interface LangChainMonitoringService {
  getHealthStatus(): Promise<LangChainHealthStatus>;
  collectMetrics(): Promise<LangChainMetrics>;
  getDashboardData(): Promise<DashboardData>;
  exportPrometheusMetrics(): string;
}
```

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review structured logs for error details
3. Monitor health endpoints
4. Check circuit breaker status
5. Verify configuration settings

## Changelog

### Version 1.0.0
- Initial LangChain integration
- Intent detection and routing
- Memory management
- Tool integration (MCP, Brave Search)
- Circuit breaker pattern
- Comprehensive monitoring
- Structured logging