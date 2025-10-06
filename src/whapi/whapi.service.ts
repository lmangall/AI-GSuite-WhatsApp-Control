import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhapiService implements OnModuleInit {
  private readonly logger = new Logger(WhapiService.name);
  private readonly token: string;
  private readonly baseUrl = 'https://gate.whapi.cloud';

  constructor(private configService: ConfigService) {
    this.token = this.configService.get<string>('WHAPI_TOKEN');
    
    if (!this.token) {
      this.logger.error('❌ WHAPI_TOKEN is not set in environment variables');
    }
  }

  async onModuleInit() {
    if (this.token) {
      await this.checkHealth();
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.token}`,
        },
      });

      const data = await response.json();

      if (data.status?.text === 'AUTH') {
        this.logger.log('✅ Whapi channel health check passed');
        return true;
      } else {
        this.logger.error(`❌ Channel not authenticated. Status: ${data.status?.text}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ Health check failed: ${error.message}`);
      return false;
    }
  }

  async setTyping(to: string, isTyping: boolean = true): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/presence`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          presence: isTyping ? 'typing' : 'available',
          delay: 0,
          to,
        }),
      });
    } catch (error) {
      this.logger.warn(`⚠️  Failed to set typing presence: ${error.message}`);
    }
  }

  async sendMessage(to: string, body: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/messages/text`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          typing_time: 0,
          to,
          body,
        }),
      });

      const data = await response.json();
      return data.sent === true;
    } catch (error) {
      this.logger.error(`❌ Failed to send message: ${error.message}`);
      return false;
    }
  }
}