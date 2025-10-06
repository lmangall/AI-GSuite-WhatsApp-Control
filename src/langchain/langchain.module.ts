import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainConfigService } from './config/langchain-config.service';
import { IntentDetectionService } from './intent/intent-detection.service';
import { IntentConfigService } from './intent/intent-config.service';
import { IntentRouterService } from './intent/intent-router.service';
import { LangChainAgentService } from './agent/langchain-agent.service';
import { LangChainMemoryManagerService } from './memory/memory-manager.service';
import { ConversationContextService } from './memory/conversation-context.service';
import { LangChainToolManagerService } from './tools/tool-manager.service';
import { LangChainPromptManagerService } from './prompts/prompt-manager.service';
import { LangChainAgentExecutorService } from './executor/agent-executor.service';
import { LangChainMonitoringService } from './monitoring/langchain-monitoring.service';
import { LangChainCircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { StructuredLoggerService } from './logging/structured-logger.service';
import { StartupValidationService } from './startup/startup-validation.service';
import { MCPModule } from '../mcp/mcp.module';
import { BraveModule } from '../webSearch/brave.module';

@Module({
    imports: [ConfigModule, MCPModule, BraveModule],
    providers: [
        LangChainConfigService,
        IntentConfigService,
        IntentDetectionService,
        IntentRouterService,
        LangChainAgentService,
        LangChainMemoryManagerService,
        ConversationContextService,
        LangChainToolManagerService,
        LangChainPromptManagerService,
        LangChainAgentExecutorService,
        LangChainMonitoringService,
        LangChainCircuitBreakerService,
        StructuredLoggerService,
        StartupValidationService,
    ],
    exports: [
        LangChainConfigService,
        IntentConfigService,
        IntentDetectionService,
        IntentRouterService,
        LangChainAgentService,
        LangChainMemoryManagerService,
        ConversationContextService,
        LangChainToolManagerService,
        LangChainPromptManagerService,
        LangChainAgentExecutorService,
        LangChainMonitoringService,
        LangChainCircuitBreakerService,
        StructuredLoggerService,
        StartupValidationService,
    ],
})
export class LangChainModule { }