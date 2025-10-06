import { Injectable, Logger } from '@nestjs/common';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { LangChainConfigService } from '../config/langchain-config.service';
import { LangChainToolManagerService } from '../tools/tool-manager.service';
import { LangChainPromptManagerService } from '../prompts/prompt-manager.service';
import { LangChainMemoryManagerService } from '../memory/memory-manager.service';
import { ConversationContextService } from '../memory/conversation-context.service';
import { IntentDetectionService } from '../intent/intent-detection.service';
import { MessageContext } from '../interfaces/langchain-config.interface';
import { 
  ILangChainAgentExecutor, 
  AgentExecutionResult, 
  AgentExecutionStats,
  AgentStep
} from './agent-executor.interface';

@Injectable()
export class LangChainAgentExecutorService implements ILangChainAgentExecutor {
  private readonly logger = new Logger(LangChainAgentExecutorService.name);
  private agentExecutor?: AgentExecutor;
  private primaryModel?: ChatGoogleGenerativeAI | ChatOpenAI;
  private fallbackModel?: ChatGoogleGenerativeAI | ChatOpenAI;
  private executionHistory: AgentExecutionResult[] = [];
  private readonly maxHistorySize = 100;

  constructor(
    private readonly configService: LangChainConfigService,
    private readonly toolManager: LangChainToolManagerService,
    private readonly promptManager: LangChainPromptManagerService,
    private readonly _memoryManager: LangChainMemoryManagerService,
    private readonly contextService: ConversationContextService,
    private readonly intentDetection: IntentDetectionService
  ) {}

  /**
   * Initialize the agent executor with tools and models
   */
  async initializeAgent(): Promise<void> {
    try {
      this.logger.log('Initializing LangChain Agent Executor...');

      // Initialize models
      await this.initializeModels();

      // Get all available tools
      const tools = await this.toolManager.getAllTools();
      this.logger.debug(`Loaded ${tools.length} tools for agent`);

      // Create agent prompt
      const agentPrompt = await this.createAgentPrompt();

      // Create the agent
      const agent = await createReactAgent({
        llm: this.primaryModel!,
        tools,
        prompt: agentPrompt
      });

      // Create agent executor
      this.agentExecutor = new AgentExecutor({
        agent,
        tools,
        maxIterations: this.configService.getLangChainConfig().maxToolCalls,
        verbose: this.configService.getLangChainConfig().enableTracing,
        returnIntermediateSteps: true
      });

      this.logger.log('✅ LangChain Agent Executor initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize agent executor:', error);
      throw new Error(`Agent executor initialization failed: ${error.message}`);
    }
  }

  /**
   * Execute agent with message context
   */
  async executeAgent(messageContext: MessageContext): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const executionResult: AgentExecutionResult = {
      success: false,
      response: '',
      toolsUsed: [],
      executionTime: 0,
      timestamp: new Date(),
      intermediateSteps: []
    };

    try {
      if (!this.agentExecutor) {
        await this.initializeAgent();
      }

      this.logger.debug(`Executing agent for user: ${messageContext.userId}`);

      // Add message to conversation context
      await this.contextService.addToContext(messageContext.userId, messageContext.messageText, true);

      // Get conversation context
      const conversationContext = await this.contextService.getFormattedContext(messageContext.userId);

      // Prepare input for agent
      // Note: agent_scratchpad is managed internally by the React agent
      const agentInput = {
        input: messageContext.messageText,
        chat_history: conversationContext
      };

      // Execute agent with timeout
      const config = this.configService.getLangChainConfig();
      const result = await this.executeWithTimeout(agentInput, config.toolTimeout);

      // Process result
      executionResult.success = true;
      executionResult.response = result.output || 'Agent executed successfully';
      executionResult.toolsUsed = this.extractToolsUsed(result.intermediateSteps || []);
      executionResult.intermediateSteps = this.formatIntermediateSteps(result.intermediateSteps || []);
      executionResult.executionTime = Date.now() - startTime;

      // Add AI response to conversation context
      await this.contextService.addToContext(messageContext.userId, executionResult.response, false);

      this.logger.debug(`Agent execution completed for user: ${messageContext.userId}`, {
        toolsUsed: executionResult.toolsUsed,
        executionTime: executionResult.executionTime
      });

    } catch (error) {
      executionResult.success = false;
      executionResult.error = error.message;
      executionResult.executionTime = Date.now() - startTime;
      
      this.logger.error(`Agent execution failed for user ${messageContext.userId}:`, error);
      
      // Try fallback response
      executionResult.response = await this.generateFallbackResponse(messageContext, error.message);
    }

    // Add to execution history
    this.addToExecutionHistory(executionResult);
    return executionResult;
  }

  /**
   * Execute agent with intent detection
   */
  async executeWithIntent(messageContext: MessageContext): Promise<AgentExecutionResult> {
    try {
      // Detect intent if not already provided
      if (!messageContext.detectedIntent) {
        messageContext.detectedIntent = await this.intentDetection.detectIntent(
          messageContext.messageText,
          messageContext
        );
      }

      this.logger.debug(`Executing agent with intent: ${messageContext.detectedIntent.intent}`);

      // Create intent-specific prompt
      await this.promptManager.createContextAwarePrompt(messageContext);
      
      // Update agent with context-aware prompt if needed
      if (this.agentExecutor && messageContext.detectedIntent.intent !== 'general_chat') {
        // For now, we'll use the existing agent but could create intent-specific agents
        this.logger.debug('Using context-aware execution for intent:', messageContext.detectedIntent.intent);
      }

      return await this.executeAgent(messageContext);
    } catch (error) {
      this.logger.error('Intent-based execution failed:', error);
      // Fallback to regular execution
      return await this.executeAgent(messageContext);
    }
  }

  /**
   * Refresh agent (reinitialize with updated tools/config)
   */
  async refreshAgent(): Promise<void> {
    try {
      this.logger.debug('Refreshing agent executor...');
      
      // Refresh tools
      await this.toolManager.refreshTools();
      
      // Reinitialize agent
      await this.initializeAgent();
      
      this.logger.log('Agent executor refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh agent:', error);
      throw error;
    }
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): AgentExecutionStats {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(r => r.success).length;
    const failed = total - successful;
    
    const avgTime = total > 0 
      ? this.executionHistory.reduce((sum, r) => sum + r.executionTime, 0) / total 
      : 0;

    const avgTools = total > 0
      ? this.executionHistory.reduce((sum, r) => sum + r.toolsUsed.length, 0) / total
      : 0;

    // Calculate most used tools
    const toolCounts = new Map<string, number>();
    this.executionHistory.forEach(r => {
      r.toolsUsed.forEach(tool => {
        toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
      });
    });

    const mostUsedTools = Array.from(toolCounts.entries())
      .map(([toolName, count]) => ({ toolName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalExecutions: total,
      successfulExecutions: successful,
      failedExecutions: failed,
      averageExecutionTime: Math.round(avgTime),
      averageToolsPerExecution: Math.round(avgTools * 100) / 100,
      mostUsedTools,
      errorRate: total > 0 ? (failed / total) * 100 : 0
    };
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit: number = 10): AgentExecutionResult[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Initialize models (primary and fallback)
   */
  private async initializeModels(): Promise<void> {
    const config = this.configService.getLangChainConfig();
    
    try {
      // Initialize primary model
      if (config.defaultModel === 'gemini') {
        this.primaryModel = new ChatGoogleGenerativeAI({
          apiKey: this.configService.getGeminiApiKey(),
          model: 'gemini-pro',
          temperature: 0.7,
          maxOutputTokens: config.maxTokens
        });
      } else {
        this.primaryModel = new ChatOpenAI({
          apiKey: this.configService.getOpenAIApiKey(),
          modelName: 'gpt-5-nano',
          temperature: 0.7,
          maxTokens: config.maxTokens
        });
      }

      // Initialize fallback model
      if (config.fallbackModel === 'openai') {
        this.fallbackModel = new ChatOpenAI({
          apiKey: this.configService.getOpenAIApiKey(),
          modelName: 'gpt-5-nano',
          temperature: 0.7,
          maxTokens: config.maxTokens
        });
      } else {
        this.fallbackModel = new ChatGoogleGenerativeAI({
          apiKey: this.configService.getGeminiApiKey(),
          model: 'gemini-pro',
          temperature: 0.7,
          maxOutputTokens: config.maxTokens
        });
      }

      this.logger.debug(`Models initialized: primary=${config.defaultModel}, fallback=${config.fallbackModel}`);
    } catch (error) {
      this.logger.error('Failed to initialize models:', error);
      throw error;
    }
  }

  /**
   * Create agent prompt template
   */
  private async createAgentPrompt(): Promise<any> {
    // Use the default React agent prompt for now
    // In a full implementation, this would use the prompt manager
    return undefined; // Let createReactAgent use its default prompt
  }

  /**
   * Execute agent with timeout
   */
  private async executeWithTimeout(input: any, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${timeout}ms`));
      }, timeout);

      this.agentExecutor!.invoke(input)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Extract tools used from intermediate steps
   */
  private extractToolsUsed(intermediateSteps: any[]): string[] {
    const toolsUsed = new Set<string>();
    
    intermediateSteps.forEach(step => {
      if (step.action && step.action.tool) {
        toolsUsed.add(step.action.tool);
      }
    });

    return Array.from(toolsUsed);
  }

  /**
   * Format intermediate steps for result
   */
  private formatIntermediateSteps(intermediateSteps: any[]): AgentStep[] {
    return intermediateSteps.map(step => ({
      action: step.action?.tool || 'unknown',
      actionInput: step.action?.toolInput || {},
      observation: step.observation || '',
      timestamp: new Date()
    }));
  }

  /**
   * Generate fallback response when agent fails
   */
  private async generateFallbackResponse(messageContext: MessageContext, error: string): Promise<string> {
    try {
      // Use prompt manager to create error handling prompt
      this.promptManager.createErrorHandlingPrompt(error, messageContext.messageText);
      
      // Try to get a response using the fallback model
      if (this.fallbackModel) {
        const response = await this.fallbackModel.invoke([
          new HumanMessage(`The user asked: "${messageContext.messageText}" but there was an error. Please provide a helpful response.`)
        ]);
        return response.content.toString();
      }
    } catch (fallbackError) {
      this.logger.error('Fallback response generation failed:', fallbackError);
    }

    // Ultimate fallback
    return `I apologize, but I encountered an error while processing your request. Please try again or rephrase your question.`;
  }

  /**
   * Add execution result to history
   */
  private addToExecutionHistory(result: AgentExecutionResult): void {
    this.executionHistory.push(result);
    
    // Keep only recent executions
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }
}