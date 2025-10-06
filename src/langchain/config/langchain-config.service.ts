import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangChainConfig } from '../interfaces/langchain-config.interface';

@Injectable()
export class LangChainConfigService {
  constructor(private configService: ConfigService) {}

  getLangChainConfig(): LangChainConfig {
    return {
      // Model configuration
      defaultModel: this.configService.get<'gemini' | 'openai'>('LANGCHAIN_DEFAULT_MODEL', 'gemini'),
      fallbackModel: this.configService.get<'gemini' | 'openai'>('LANGCHAIN_FALLBACK_MODEL', 'openai'),
      
      // Memory configuration
      memoryType: this.configService.get<'buffer' | 'summary' | 'conversation'>('LANGCHAIN_MEMORY_TYPE', 'conversation'),
      maxTokens: this.configService.get<number>('LANGCHAIN_MAX_TOKENS', 4000),
      memoryExpiryHours: this.configService.get<number>('LANGCHAIN_MEMORY_EXPIRY_HOURS', 24),
      
      // Tool configuration
      enabledTools: this.configService.get<string>('LANGCHAIN_ENABLED_TOOLS', 'mcp,brave_search').split(','),
      toolTimeout: this.configService.get<number>('LANGCHAIN_TOOL_TIMEOUT', 30000),
      maxToolCalls: this.configService.get<number>('LANGCHAIN_MAX_TOOL_CALLS', 5),
      
      // Prompt configuration
      systemPromptPath: this.configService.get<string>('LANGCHAIN_SYSTEM_PROMPT_PATH'),
      promptTemplatesPath: this.configService.get<string>('LANGCHAIN_PROMPT_TEMPLATES_PATH'),
      
      // Performance configuration
      enableTracing: this.configService.get<boolean>('LANGCHAIN_ENABLE_TRACING', false),
      enableMetrics: this.configService.get<boolean>('LANGCHAIN_ENABLE_METRICS', true),
      cacheEnabled: this.configService.get<boolean>('LANGCHAIN_CACHE_ENABLED', true),
    };
  }

  getGeminiApiKey(): string {
    return this.configService.get<string>('GEMINI_API_KEY', '');
  }

  getOpenAIApiKey(): string {
    return this.configService.get<string>('OPENAI_API_KEY', '');
  }

  getBraveApiKey(): string {
    return this.configService.get<string>('BRAVE_SEARCH_API_KEY', '');
  }

  getMCPServerUrl(): string {
    return this.configService.get<string>('MCP_SERVER_URL', '');
  }

  // Memory-specific configuration getters
  getMemoryType(): string {
    return this.configService.get<string>('LANGCHAIN_MEMORY_TYPE', 'conversation');
  }

  getMaxTokens(): number {
    return this.configService.get<number>('LANGCHAIN_MAX_TOKENS', 4000);
  }

  getMemoryExpiryHours(): number {
    return this.configService.get<number>('LANGCHAIN_MEMORY_EXPIRY_HOURS', 24);
  }

  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.getLangChainConfig();

    // Validate API keys
    if (!this.getGeminiApiKey() && config.defaultModel === 'gemini') {
      errors.push('GEMINI_API_KEY is required when using Gemini as default model');
    }

    if (!this.getOpenAIApiKey() && config.fallbackModel === 'openai') {
      errors.push('OPENAI_API_KEY is required when using OpenAI as fallback model');
    }

    // Validate numeric values
    if (config.maxTokens <= 0) {
      errors.push('LANGCHAIN_MAX_TOKENS must be greater than 0');
    }

    if (config.memoryExpiryHours <= 0) {
      errors.push('LANGCHAIN_MEMORY_EXPIRY_HOURS must be greater than 0');
    }

    if (config.toolTimeout <= 0) {
      errors.push('LANGCHAIN_TOOL_TIMEOUT must be greater than 0');
    }

    if (config.maxToolCalls <= 0) {
      errors.push('LANGCHAIN_MAX_TOOL_CALLS must be greater than 0');
    }

    // Validate enabled tools
    const validTools = ['mcp', 'brave_search'];
    const invalidTools = config.enabledTools.filter(tool => !validTools.includes(tool));
    if (invalidTools.length > 0) {
      errors.push(`Invalid tools specified: ${invalidTools.join(', ')}. Valid tools: ${validTools.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}