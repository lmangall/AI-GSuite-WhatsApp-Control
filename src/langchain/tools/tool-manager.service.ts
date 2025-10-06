import { Injectable, Logger } from '@nestjs/common';
import { DynamicTool } from '@langchain/core/tools';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { GoogleWorkspaceMCPService } from '../../mcp/google-workspace-mcp.service';
import { BraveService } from '../../webSearch/brave.service';
import { LangChainConfigService } from '../config/langchain-config.service';
import { 
  ILangChainToolManager, 
  LangChainTool, 
  MCPToolConversionResult, 
  ToolDiscoveryResult,
  ToolExecutionContext
} from './tool-manager.interface';
import { ToolExecutionResult } from '../interfaces/langchain-config.interface';

@Injectable()
export class LangChainToolManagerService implements ILangChainToolManager {
  private readonly logger = new Logger(LangChainToolManagerService.name);
  private tools: Map<string, LangChainTool> = new Map();
  private lastDiscoveryTime?: Date;

  constructor(
    private readonly googleWorkspaceService: GoogleWorkspaceMCPService,
    private readonly braveService: BraveService,
    private readonly configService: LangChainConfigService
  ) {}

  /**
   * Discover and convert MCP tools to LangChain format
   */
  async discoverMCPTools(): Promise<LangChainTool[]> {
    try {
      this.logger.log('🔍 Discovering MCP tools...');
      
      const mcpTools = await this.googleWorkspaceService.listTools();
      this.logger.log(`📦 Found ${mcpTools.length} MCP tools from MCP service`);
      
      const discoveryResult: ToolDiscoveryResult = {
        totalFound: mcpTools.length,
        successfulConversions: 0,
        failedConversions: 0,
        tools: [],
        errors: []
      };

      for (const mcpTool of mcpTools) {
        this.logger.debug(`🔄 Converting MCP tool: ${mcpTool.name}`);
        const conversionResult = this.convertMCPToolToLangChain(mcpTool);
        
        if (conversionResult.success && conversionResult.tool) {
          discoveryResult.tools.push(conversionResult.tool);
          discoveryResult.successfulConversions++;
          this.tools.set(conversionResult.tool.name, conversionResult.tool);
          this.logger.debug(`✅ Successfully converted: ${mcpTool.name}`);
        } else {
          discoveryResult.failedConversions++;
          if (conversionResult.error) {
            discoveryResult.errors.push(`${mcpTool.name}: ${conversionResult.error}`);
            this.logger.warn(`❌ Failed to convert ${mcpTool.name}: ${conversionResult.error}`);
          }
        }
      }

      this.lastDiscoveryTime = new Date();
      
      this.logger.log(
        `✅ MCP tool discovery completed: ${discoveryResult.successfulConversions}/${discoveryResult.totalFound} tools converted successfully`
      );

      if (discoveryResult.errors.length > 0) {
        this.logger.warn(`⚠️  Tool conversion errors (${discoveryResult.errors.length}):`, discoveryResult.errors);
      }

      return discoveryResult.tools;
    } catch (error) {
      this.logger.error('❌ Failed to discover MCP tools:', error);
      throw new Error(`MCP tool discovery failed: ${error.message}`);
    }
  }

  /**
   * Create Brave Search tool
   */
  createBraveSearchTool(): LangChainTool {
    const braveSearchTool = new DynamicTool({
      name: 'brave_search',
      description: 'Search the web using Brave Search API for current information, news, and real-time data. Input should be a search query string.',
      func: async (query: string): Promise<string> => {
        const searchStartTime = Date.now();
        this.logger.log(`🔍 [BRAVE_SEARCH] Tool invoked with query: "${query}"`);
        
        try {
          // Validate query
          if (!query || typeof query !== 'string' || query.trim().length === 0) {
            this.logger.error(`🔍 [BRAVE_SEARCH] Invalid or empty search query provided`);
            throw new Error('Search query is required and must be a non-empty string');
          }

          const searchQuery = query.trim();

          // Optimize search query
          this.logger.debug(`🔍 [BRAVE_SEARCH] Optimizing query...`);
          const optimizedQuery = this.optimizeSearchQuery(searchQuery);
          this.logger.log(`🔍 [BRAVE_SEARCH] Executing search with optimized query: "${optimizedQuery}"`);

          // Execute search with timeout
          this.logger.log(`🔍 [BRAVE_SEARCH] ⏰ [STEP 1/4] Starting braveService.search() call...`);
          
          const searchPromise = this.braveService.search({
            query: optimizedQuery,
            count: 5,
            country: 'us',
            search_lang: 'en'
          }).then(result => {
            this.logger.log(`🔍 [BRAVE_SEARCH] ✅ [STEP 2/4] braveService.search() returned successfully`);
            return result;
          }).catch(error => {
            this.logger.error(`🔍 [BRAVE_SEARCH] ❌ [STEP 2/4] braveService.search() threw error:`, error.message);
            throw error;
          });

          this.logger.log(`🔍 [BRAVE_SEARCH] ⏰ [STEP 3/4] Setting up 5s timeout...`);
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => {
              this.logger.error(`🔍 [BRAVE_SEARCH] ⏱️ TIMEOUT after 5 seconds - braveService.search() did not complete`);
              reject(new Error('Brave search timeout after 5 seconds'));
            }, 5000)
          );

          this.logger.log(`🔍 [BRAVE_SEARCH] ⏰ Racing promises (search vs 5s timeout)...`);
          const searchResult = await Promise.race([searchPromise, timeoutPromise]);
          this.logger.log(`🔍 [BRAVE_SEARCH] ✅ [STEP 4/4] Promise race completed, processing results...`);


          const searchDuration = Date.now() - searchStartTime;
          const resultCount = searchResult?.web?.results?.length || 0;
          
          this.logger.log(`✅ [BRAVE_SEARCH] Search completed: ${resultCount} results in ${searchDuration}ms`);
          this.logger.debug(`🔍 [BRAVE_SEARCH] Formatting results...`);

          // Format results for WhatsApp
          const formattedResults = this.formatBraveSearchResults(searchResult, searchQuery);
          this.logger.debug(`🔍 [BRAVE_SEARCH] Results formatted, length: ${formattedResults.length} chars`);
          
          return formattedResults;
        } catch (error) {
          const searchDuration = Date.now() - searchStartTime;
          this.logger.error(`❌ [BRAVE_SEARCH] Search failed after ${searchDuration}ms:`, error);
          this.logger.error(`❌ [BRAVE_SEARCH] Error stack:`, error.stack);
          
          // Return a user-friendly error message instead of throwing
          const errorMessage = `I apologize, but I encountered an error while searching for "${query}". The search service may be temporarily unavailable. Error: ${error.message}`;
          this.logger.log(`🔍 [BRAVE_SEARCH] Returning error message to agent`);
          return errorMessage;
        }
      }
    }) as LangChainTool;

    braveSearchTool.source = 'brave';
    // DynamicTool expects a simple string input, not an object schema
    braveSearchTool.timeout = 15000;
    braveSearchTool.retries = 1;

    return braveSearchTool;
  }

  /**
   * Get all available tools (MCP + Brave Search)
   */
  async getAllTools(): Promise<LangChainTool[]> {
    try {
      const allTools: LangChainTool[] = [];
      
      this.logger.log('🔍 Getting all available tools...');
      
      // Get MCP tools
      this.logger.debug('📦 Discovering MCP tools...');
      const mcpTools = await this.discoverMCPTools();
      allTools.push(...mcpTools);
      this.logger.log(`✅ Loaded ${mcpTools.length} MCP tools`);
      
      // Add Brave Search tool if enabled
      const enabledTools = this.configService.getLangChainConfig().enabledTools;
      this.logger.debug(`🔧 Enabled tools in config: ${enabledTools.join(', ')}`);
      
      if (enabledTools.includes('brave_search')) {
        this.logger.log('🔍 Brave search is enabled, creating tool...');
        const braveSearchTool = this.createBraveSearchTool();
        allTools.push(braveSearchTool);
        this.tools.set(braveSearchTool.name, braveSearchTool);
        this.logger.log('✅ Brave search tool created and added');
      } else {
        this.logger.warn('⚠️  Brave search is NOT enabled in config');
      }

      this.logger.log(`✅ Total tools available: ${allTools.length}`);
      allTools.forEach((tool, index) => {
        this.logger.log(`   ${index + 1}. ${tool.name} (source: ${(tool as any).source || 'unknown'})`);
      });
      
      return allTools;
    } catch (error) {
      this.logger.error('❌ Failed to get all tools:', error);
      throw new Error(`Failed to get all tools: ${error.message}`);
    }
  }

  /**
   * Execute a tool by name with arguments
   */
  async executeTool(toolName: string, args: any): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const executionResult: ToolExecutionResult = {
      toolName,
      success: false,
      executionTime: 0,
      timestamp: new Date()
    };

    try {
      const tool = this.getToolByName(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      this.logger.debug(`Executing tool: ${toolName}`, { args });

      // Execute with timeout
      const timeout = tool.timeout || this.configService.getLangChainConfig().toolTimeout;
      const result = await this.executeWithTimeout(tool, args, timeout);

      executionResult.success = true;
      executionResult.result = result;
      executionResult.executionTime = Date.now() - startTime;

      this.logger.debug(`Tool ${toolName} executed successfully`, {
        executionTime: executionResult.executionTime
      });

      this.addToExecutionHistory(executionResult);
      return executionResult;
    } catch (error) {
      executionResult.success = false;
      executionResult.error = error.message;
      executionResult.executionTime = Date.now() - startTime;

      this.logger.error(`Tool ${toolName} execution failed:`, error);
      this.addToExecutionHistory(executionResult);
      return executionResult;
    }
  }

  /**
   * Convert MCP tool to LangChain format
   */
  convertMCPToolToLangChain(mcpTool: MCPTool): MCPToolConversionResult {
    try {
      this.logger.debug(`Converting MCP tool: ${mcpTool.name}`);

      // Validate MCP tool
      const validationErrors = this.validateMCPTool(mcpTool);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Validation failed: ${validationErrors.join(', ')}`,
          validationErrors
        };
      }

      // Create LangChain tool using DynamicTool
      const langChainTool = new DynamicTool({
        name: mcpTool.name || 'unknown_tool',
        description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
        func: async (args: string): Promise<string> => {
          try {
            // Parse arguments if they're a string
            let parsedArgs: Record<string, any> = {};
            if (typeof args === 'string') {
              try {
                parsedArgs = JSON.parse(args);
              } catch {
                // If parsing fails, treat as a simple string argument
                parsedArgs = { input: args };
              }
            } else {
              parsedArgs = args as any;
            }

            this.logger.debug(`Executing MCP tool: ${mcpTool.name}`, { args: parsedArgs });
            
            const result = await this.googleWorkspaceService.callTool(mcpTool.name!, parsedArgs);
            
            // Format result as string for LangChain
            if (typeof result === 'string') {
              return result;
            } else if (result && typeof result === 'object') {
              return JSON.stringify(result, null, 2);
            } else {
              return String(result || 'Tool executed successfully');
            }
          } catch (error) {
            this.logger.error(`Error executing MCP tool ${mcpTool.name}:`, error);
            throw new Error(`MCP tool execution failed: ${error.message}`);
          }
        }
      }) as LangChainTool;

      // Add additional properties
      langChainTool.source = 'mcp';
      langChainTool.schema = mcpTool.inputSchema || {};
      langChainTool.timeout = 30000;
      langChainTool.retries = 2;

      // Validate the converted tool
      if (!this.validateToolSchema(langChainTool)) {
        return {
          success: false,
          error: 'Converted tool failed schema validation'
        };
      }

      return {
        success: true,
        tool: langChainTool
      };
    } catch (error) {
      return {
        success: false,
        error: `Conversion failed: ${error.message}`
      };
    }
  }

  /**
   * Validate LangChain tool schema
   */
  validateToolSchema(tool: LangChainTool): boolean {
    try {
      // Basic validation
      if (!tool.name || typeof tool.name !== 'string') {
        this.logger.warn(`Tool validation failed: invalid name`);
        return false;
      }

      if (!tool.description || typeof tool.description !== 'string') {
        this.logger.warn(`Tool validation failed: invalid description for ${tool.name}`);
        return false;
      }

      if (typeof tool.call !== 'function') {
        this.logger.warn(`Tool validation failed: missing call method for ${tool.name}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Tool validation error for ${tool.name}:`, error);
      return false;
    }
  }

  /**
   * Refresh all tools (re-discover MCP tools)
   */
  async refreshTools(): Promise<void> {
    try {
      this.logger.debug('Refreshing tools...');
      this.tools.clear();
      await this.getAllTools();
      this.logger.log('Tools refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh tools:', error);
      throw new Error(`Tool refresh failed: ${error.message}`);
    }
  }

  /**
   * Get tool by name
   */
  getToolByName(name: string): LangChainTool | null {
    return this.tools.get(name) || null;
  }

  /**
   * Get tool statistics
   */
  getToolStats(): { totalTools: number; mcpTools: number; braveTools: number; lastDiscovery?: Date } {
    const tools = Array.from(this.tools.values());
    return {
      totalTools: tools.length,
      mcpTools: tools.filter(t => t.source === 'mcp').length,
      braveTools: tools.filter(t => t.source === 'brave').length,
      lastDiscovery: this.lastDiscoveryTime
    };
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool exists
   */
  hasToolByName(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tools by source
   */
  getToolsBySource(source: 'mcp' | 'brave' | 'internal'): LangChainTool[] {
    return Array.from(this.tools.values()).filter(tool => tool.source === source);
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeToolsSequentially(toolExecutions: { toolName: string; args: any }[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    
    for (const execution of toolExecutions) {
      try {
        const result = await this.executeTool(execution.toolName, execution.args);
        results.push(result);
        
        // Stop on first failure if configured
        if (!result.success) {
          this.logger.warn(`Tool execution failed, stopping sequence: ${execution.toolName}`);
          break;
        }
      } catch (error) {
        this.logger.error(`Error in tool sequence execution:`, error);
        results.push({
          toolName: execution.toolName,
          success: false,
          error: error.message,
          executionTime: 0,
          timestamp: new Date()
        });
        break;
      }
    }
    
    return results;
  }

  /**
   * Format tool execution results for user display
   */
  formatToolResults(results: ToolExecutionResult[]): string {
    if (results.length === 0) {
      return 'No tool results to display.';
    }

    if (results.length === 1) {
      const result = results[0];
      if (result.success) {
        return result.result || 'Tool executed successfully';
      } else {
        return `❌ Tool execution failed: ${result.error}`;
      }
    }

    // Multiple results
    let formatted = `🔧 Tool Execution Results:\n\n`;
    results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      formatted += `${index + 1}. ${status} ${result.toolName}\n`;
      
      if (result.success && result.result) {
        const truncatedResult = result.result.length > 100 
          ? result.result.substring(0, 100) + '...' 
          : result.result;
        formatted += `   ${truncatedResult}\n`;
      } else if (!result.success && result.error) {
        formatted += `   Error: ${result.error}\n`;
      }
      
      formatted += `   ⏱️ ${result.executionTime}ms\n\n`;
    });

    return formatted;
  }

  /**
   * Validate tool arguments against schema
   */
  validateToolArguments(toolName: string, args: any): { valid: boolean; errors: string[] } {
    const tool = this.getToolByName(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool '${toolName}' not found`] };
    }

    const errors: string[] = [];
    
    // Basic validation - check if required properties exist
    if (tool.schema && tool.schema.required) {
      const requiredFields = tool.schema.required;
      const providedArgs = typeof args === 'string' ? { input: args } : args || {};
      
      for (const field of requiredFields) {
        if (!(field in providedArgs)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get tool execution history (simple in-memory tracking)
   */
  private executionHistory: ToolExecutionResult[] = [];
  private readonly maxHistorySize = 100;

  private addToExecutionHistory(result: ToolExecutionResult): void {
    this.executionHistory.push(result);
    
    // Keep only recent executions
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get recent tool execution history
   */
  getExecutionHistory(limit: number = 10): ToolExecutionResult[] {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    mostUsedTool?: string;
  } {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(r => r.success).length;
    const failed = total - successful;
    
    const avgTime = total > 0 
      ? this.executionHistory.reduce((sum, r) => sum + r.executionTime, 0) / total 
      : 0;

    // Find most used tool
    const toolCounts = new Map<string, number>();
    this.executionHistory.forEach(r => {
      toolCounts.set(r.toolName, (toolCounts.get(r.toolName) || 0) + 1);
    });
    
    let mostUsedTool: string | undefined;
    let maxCount = 0;
    for (const [tool, count] of toolCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedTool = tool;
      }
    }

    return {
      totalExecutions: total,
      successfulExecutions: successful,
      failedExecutions: failed,
      averageExecutionTime: Math.round(avgTime),
      mostUsedTool
    };
  }

  /**
   * Validate MCP tool before conversion
   */
  private validateMCPTool(mcpTool: MCPTool): string[] {
    const errors: string[] = [];

    if (!mcpTool.name || typeof mcpTool.name !== 'string') {
      errors.push('Tool name is required and must be a string');
    }

    if (mcpTool.name && mcpTool.name.length === 0) {
      errors.push('Tool name cannot be empty');
    }

    // Description is optional but should be string if provided
    if (mcpTool.description && typeof mcpTool.description !== 'string') {
      errors.push('Tool description must be a string if provided');
    }

    return errors;
  }

  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout(tool: LangChainTool, args: any, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.logger.error(`⏱️ Tool ${tool.name} execution timed out after ${timeout}ms`);
          reject(new Error(`Tool execution timed out after ${timeout}ms`));
        }
      }, timeout);

      tool.call(args)
        .then(result => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        })
        .catch(error => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            this.logger.error(`❌ Tool ${tool.name} execution failed:`, error);
            reject(error);
          }
        });
    });
  }

  /**
   * Optimize search query for better results
   */
  private optimizeSearchQuery(query: string): string {
    // Remove common conversational words
    const stopWords = ['please', 'can you', 'tell me', 'what is', 'what are', 'how to', 'show me'];
    let optimizedQuery = query.toLowerCase();

    stopWords.forEach(stopWord => {
      optimizedQuery = optimizedQuery.replace(new RegExp(`\\b${stopWord}\\b`, 'gi'), '');
    });

    // Clean up extra spaces
    optimizedQuery = optimizedQuery.replace(/\s+/g, ' ').trim();

    // Add quotes for exact phrases if needed
    if (optimizedQuery.includes(' and ') || optimizedQuery.includes(' or ')) {
      // Keep as is for boolean queries
      return optimizedQuery;
    }

    // For short queries, return as is
    if (optimizedQuery.split(' ').length <= 2) {
      return optimizedQuery;
    }

    return optimizedQuery;
  }

  /**
   * Format Brave search results for WhatsApp
   */
  private formatBraveSearchResults(searchResult: any, originalQuery: string): string {
    try {
      if (!searchResult?.web?.results || searchResult.web.results.length === 0) {
        return `No search results found for "${originalQuery}". Please try a different search query.`;
      }

      const results = searchResult.web.results.slice(0, 3); // Top 3 results for WhatsApp
      let formattedResponse = `🔍 Search results for "${originalQuery}":\n\n`;

      results.forEach((result: any, index: number) => {
        const title = result.title || 'No title';
        const description = result.description || 'No description available';
        const url = result.url || '';

        // Truncate description for WhatsApp
        const truncatedDescription = description.length > 150 
          ? description.substring(0, 150) + '...' 
          : description;

        formattedResponse += `${index + 1}. **${title}**\n`;
        formattedResponse += `${truncatedDescription}\n`;
        if (url) {
          formattedResponse += `🔗 ${url}\n`;
        }
        formattedResponse += '\n';
      });

      // Add footer
      formattedResponse += `_Found ${searchResult.web.results.length} total results_`;

      return formattedResponse;
    } catch (error) {
      this.logger.error('Error formatting search results:', error);
      return `Search completed for "${originalQuery}" but there was an error formatting the results. Please try again.`;
    }
  }

  /**
   * Extract search query from user message
   */
  extractSearchQuery(message: string): string {
    // Remove common question words and phrases
    const patterns = [
      /^(search for|look up|find|what is|what are|tell me about|show me)\s+/i,
      /^(can you|please|could you)\s+(search for|look up|find|tell me about)\s+/i,
      /\?$/
    ];

    let query = message;
    patterns.forEach(pattern => {
      query = query.replace(pattern, '');
    });

    return query.trim();
  }
}