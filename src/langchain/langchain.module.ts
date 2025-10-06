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
import { GoogleWorkspaceModule } from '../mcp/google-workspace.module';
import { BraveModule } from '../webSearch/brave.module';
import { ResultFormatterService } from './formatters/result-formatter.service';
import { GreetingResponseService } from './responses/greeting-response.service';
import { FastIntentRouterService } from './intent/fast-intent-router.service';
import { LangChainRouterService } from './langchain-router.service';
import { EmailHandlerService } from './services/email-handler.service';

@Module({
    imports: [ConfigModule, GoogleWorkspaceModule, BraveModule],
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
        ResultFormatterService,
        GreetingResponseService,
        FastIntentRouterService,
        LangChainRouterService,
        EmailHandlerService,
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
        FastIntentRouterService,
        LangChainRouterService,
    ],
})
export class LangChainModule { }