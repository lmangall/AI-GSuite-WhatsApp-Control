import { Controller, Post, Patch, Body, Logger, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { WhapiService } from './whapi.service';
import { WebhookMessagesPayloadDto } from './dto/webhook-message.dto';
import { WebhookChatsPayloadDto } from './dto/webhook-chat.dto';
import { MCPService } from '../mcp/mcp.service';

@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly processedMessages = new Set<string>();
  private readonly channelId = process.env.WHATSAPP_CHANNEL_ID || 'default-channel';

  constructor(
    private readonly whapiService: WhapiService,
    private readonly mcpService: MCPService,
  ) {}

  @Post(`:channelId/messages`)
  @HttpCode(HttpStatus.OK)
  async handleMessagesWebhook(
    @Param('channelId') channelId: string,
    @Body() payload: WebhookMessagesPayloadDto
  ) {
    const requestId = Math.random().toString(36).substring(2, 8);
    this.logger.log(`[${requestId}] 📩 Received messages webhook for channel: ${channelId}`);
    
    if (!payload.messages || payload.messages.length === 0) {
      this.logger.log(`[${requestId}] No messages in payload`);
      return { status: 'ok' };
    }

    // Process each message
    for (const message of payload.messages) {
      await this.processIncomingMessage(message, requestId);
    }

    return { status: 'ok' };
  }

  @Patch(`:channelId/chats`)
  @HttpCode(HttpStatus.OK)
  async handleChatsWebhook(
    @Param('channelId') channelId: string,
    @Body() payload: WebhookChatsPayloadDto
  ) {
    const requestId = Math.random().toString(36).substring(2, 8);
    this.logger.log(`[${requestId}] 💬 Received chats webhook for channel: ${channelId}`);
    
    if (!payload.chats_updates || payload.chats_updates.length === 0) {
      this.logger.log(`[${requestId}] No chat updates in payload`);
      return { status: 'ok' };
    }

    // Process each chat update
    for (const update of payload.chats_updates) {
      await this.processChatUpdate(update, requestId);
    }

    return { status: 'ok' };
  }

  private async processIncomingMessage(message: any, requestId: string) {
    const messageId = message.id;
    
    // Skip duplicate messages
    if (this.processedMessages.has(messageId)) {
      this.logger.log(`[${requestId}] ⏩ Skipping duplicate message: ${messageId}`);
      return;
    }
    this.processedMessages.add(messageId);
    
    // Cleanup old message IDs to prevent memory leaks
    if (this.processedMessages.size > 1000) {
      const first = this.processedMessages.values().next().value;
      this.processedMessages.delete(first);
    }

    // Skip messages from self or bots
    if (message.from_me || message.from.endsWith('@c.us') || message.from.endsWith('@g.us')) {
      this.logger.log(`[${requestId}] ⏩ Skipping message from self/bot: ${message.from}`);
      return;
    }

    // Only process text messages
    if (message.type !== 'text' || !message.text?.body) {
      this.logger.log(`[${requestId}] ⏩ Skipping non-text message of type: ${message.type}`);
      return;
    }

    const originalMessage = message.text.body;
    const senderPhone = message.chat_id.replace('@s.whatsapp.net', '');

    this.logger.log(
      `[${requestId}] 📨 Processing message from ${senderPhone} (${message.chat_id}): "${originalMessage}"`
    );

    try {
      // === MCP INTEGRATION: List available tools ===
      this.logger.log(`[${requestId}] 🔧 Fetching MCP tools...`);
      const tools = await this.mcpService.listTools();
      
      this.logger.log(`\n[${requestId}] 🛠️  Available MCP Tools (${tools.length} found):`);
      this.logger.log('='.repeat(60));
      
      tools.forEach((tool, index) => {
        this.logger.log(`\n${index + 1}. ${tool.name}`);
        this.logger.log(`   Description: ${tool.description || 'No description'}`);
        
        if (tool.inputSchema) {
          const schema = tool.inputSchema as any;
          if (schema.properties) {
            this.logger.log(`   Parameters:`);
            Object.keys(schema.properties).forEach(param => {
              const prop = schema.properties[param];
              this.logger.log(`     - ${param}: ${prop.type || 'any'} ${prop.description ? `(${prop.description})` : ''}`);
            });
          }
        }
      });
      
      this.logger.log('\n' + '='.repeat(60) + '\n');
      // === END MCP INTEGRATION ===

      // Send reply back to WhatsApp (keeping original functionality for now)
      const replyText = `[${requestId}] Received: ${originalMessage}`;
      const sent = await this.whapiService.sendMessage(senderPhone, replyText);

      if (sent) {
        this.logger.log(`[${requestId}] ✅ Reply sent to ${senderPhone}`);
      } else {
        this.logger.error(`[${requestId}] ❌ Failed to send reply to ${senderPhone}`);
      }
    } catch (error) {
      this.logger.error(`[${requestId}] ❌ Error processing message: ${error.message}`, error.stack);
    }
  }

  private async processChatUpdate(update: any, requestId: string) {
    const chatId = update.after_update?.id || 'unknown';
    this.logger.log(
      `[${requestId}] 🔄 Processing chat update for ${chatId}. ` +
      `Changes: ${update.changes.join(', ')}`
    );

    // Log important changes
    if (update.changes.includes('unread') && update.after_update?.unread > 0) {
      this.logger.log(
        `[${requestId}] 💬 New unread messages in ${chatId}: ${update.after_update.unread}`
      );
    }

    // Handle last message updates
    if (update.changes.includes('last_message') && update.after_update?.last_message) {
      const msg = update.after_update.last_message;
      if (!msg.from_me && msg.text?.body) {
        this.logger.log(
          `[${requestId}] 💭 New message in ${chatId} from ${msg.from_name || msg.from}: ` +
          `"${msg.text.body.substring(0, 50)}${msg.text.body.length > 50 ? '...' : ''}"`
        );
      }
    }
  }
}