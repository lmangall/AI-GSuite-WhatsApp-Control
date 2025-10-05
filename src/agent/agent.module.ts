import { Module } from '@nestjs/common';
import { GeminiAgentService } from './gemini-agent.service';
import { OpenAIAgentService } from './openai-agent.service';
import { AgentFactoryService } from './agent-factory.service';
import { MCPModule } from '../mcp/mcp.module';

const AGENT_SERVICE = 'AGENT_SERVICE';

@Module({
  imports: [MCPModule],
  providers: [
    GeminiAgentService,
    OpenAIAgentService,
    AgentFactoryService,
    {
      provide: AGENT_SERVICE,
      useExisting: AgentFactoryService,
    },
  ],
  exports: [AGENT_SERVICE],
})
export class AgentModule {}

export { AGENT_SERVICE };