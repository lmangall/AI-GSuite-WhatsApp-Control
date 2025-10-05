import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini-agent.service';
import { OpenAIAgentService } from './openai-agent.service';
import { MCPModule } from '../mcp/mcp.module';
import { IAgentService } from './agent.interface';

const AGENT_SERVICE = 'AGENT_SERVICE';

@Module({
  imports: [MCPModule],
  providers: [
    GeminiService,
    OpenAIAgentService,
    {
      provide: AGENT_SERVICE,
      useFactory: (
        configService: ConfigService,
        geminiService: GeminiService,
        openaiService: OpenAIAgentService,
      ): IAgentService => {
        const provider = configService.get<string>('AI_PROVIDER', 'gemini').toLowerCase();
        
        if (provider === 'openai') {
          return openaiService;
        }
        
        return geminiService;
      },
      inject: [ConfigService, GeminiService, OpenAIAgentService],
    },
  ],
  exports: [AGENT_SERVICE],
})
export class AgentModule {}

export { AGENT_SERVICE };