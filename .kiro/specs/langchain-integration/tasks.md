# Implementation Plan

- [x] 1. Install LangChain.js dependencies and setup basic configuration
  - Add @langchain/core, @langchain/google-genai, @langchain/openai, and @langchain/community packages
  - Create LangChain configuration interface and environment variable handling
  - Set up basic NestJS module structure for LangChain integration
  - _Requirements: 1.1, 6.1_

- [x] 2. Implement Intent Detection Service
  - [x] 2.1 Create intent detection interface and service class
    - Define IntentDetectionResult and IntentPattern interfaces
    - Implement pattern matching for web search, MCP tools, and general chat intents
    - Add keyword and regex-based intent classification
    - _Requirements: 5.2_

  - [x] 2.2 Configure intent patterns and routing logic
    - Create configuration for web search keywords (news, latest, current, weather, etc.)
    - Define MCP tool intent patterns (send email, schedule, create, add to calendar)
    - Implement confidence scoring and fallback to general chat
    - _Requirements: 5.2_

- [x] 3. Create LangChain Agent Service foundation
  - [x] 3.1 Implement core LangChain agent service class
    - Create LangChainAgentService implementing IAgentService interface
    - Set up Gemini and OpenAI model initialization with fallback logic
    - Implement basic processMessage method structure
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 3.2 Implement model management and fallback system
    - Create getPrimaryModel() and getFallbackModel() methods
    - Implement automatic fallback when Gemini is unavailable
    - Add error handling and logging for model switching
    - _Requirements: 1.4_

- [x] 4. Implement LangChain Memory Manager
  - [x] 4.1 Create memory management service
    - Implement ChatMessageHistory creation and management per user
    - Create ConversationBufferMemory and ConversationSummaryMemory strategies
    - Add memory cleanup and expiration handling
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 4.2 Integrate memory with conversation context
    - Implement addToContext and getContext methods using LangChain memory
    - Add context summarization when token limits are exceeded
    - Create memory statistics and monitoring
    - _Requirements: 2.2, 2.3_

- [x] 5. Create LangChain Tool Manager
  - [x] 5.1 Implement MCP tool conversion to LangChain format
    - Create convertMCPToolToLangChain method
    - Implement tool schema validation and conversion
    - Add error handling for tool discovery and conversion
    - _Requirements: 3.1, 3.2_

  - [x] 5.2 Integrate Brave Search as LangChain tool
    - Create Brave search tool wrapper using existing BraveService
    - Implement search query extraction and optimization
    - Add search result formatting for WhatsApp responses
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 5.3 Implement tool execution and management
    - Create getAllTools method combining MCP and Brave search tools
    - Implement tool execution with timeout and error handling
    - Add tool result formatting and error messaging
    - _Requirements: 3.3, 3.4, 3.5, 5.5_

- [x] 6. Create LangChain Prompt Manager
  - [x] 6.1 Implement prompt template management
    - Create system prompt templates for different contexts
    - Implement dynamic prompt selection based on intent
    - Add prompt template loading from configuration files
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Create context-aware prompt strategies
    - Implement different prompt templates for web search, MCP tools, and general chat
    - Add user context integration into prompt templates
    - Create output parsing strategies for structured responses
    - _Requirements: 4.2, 4.4_

- [x] 7. Implement Agent Executor integration
  - [x] 7.1 Create Agent Executor with tool integration
    - Set up LangChain AgentExecutor with tools and memory
    - Implement agent execution with proper error handling
    - Add logging and monitoring for agent execution steps
    - _Requirements: 1.3, 1.5_

  - [x] 7.2 Integrate intent detection with Agent Executor
    - Implement processMessageWithIntent method
    - Route messages to appropriate tools based on detected intent
    - Add fallback handling when intent detection fails
    - _Requirements: 5.2_

- [x] 8. Update Agent Factory Service for LangChain integration
  - [x] 8.1 Replace existing agent implementation with LangChain
    - Update AgentFactoryService to use LangChain agent as primary implementation
    - Keep existing agents as emergency fallback only
    - Update error handling and fallback logic
    - _Requirements: 1.4, 6.2_

  - [x] 8.2 Implement configuration validation and monitoring
    - Create configuration validation and startup checks
    - Add health checks and monitoring for LangChain components
    - Implement proper service lifecycle management
    - _Requirements: 6.1, 6.3_

- [x] 9. Add comprehensive error handling and logging
  - [x] 9.1 Implement circuit breaker pattern for LangChain operations
    - Create circuit breaker for model calls and tool executions
    - Add automatic fallback to base agent service when circuit is open
    - Implement recovery and health monitoring
    - _Requirements: 1.4_

  - [x] 9.2 Add comprehensive logging and monitoring
    - Implement structured logging for all LangChain operations
    - Add performance metrics collection (response times, tool usage, etc.)
    - Create monitoring dashboards for LangChain health and usage
    - _Requirements: 6.3, 6.4_

- [x] 10. Final integration and configuration
  - [x] 10.1 Wire all components together in the main application
    - Update app.module.ts to include all LangChain services
    - Ensure proper dependency injection and service lifecycle management
    - Add startup validation and configuration checks
    - _Requirements: 1.1, 6.1_

  - [x] 10.2 Create configuration files and documentation
    - Create example configuration files for different deployment scenarios
    - Add environment variable documentation
    - Create troubleshooting guide for common issues
    - _Requirements: 6.1, 6.2_