import { Controller, Post, Patch, Body, Logger, Param, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { WhapiService } from './whapi.service';
import { WebhookMessagesPayloadDto } from './dto/webhook-message.dto';
import { WebhookChatsPayloadDto } from './dto/webhook-chat.dto';
import { IAgentService } from '../agent/agent.interface';
import { AGENT_SERVICE } from '../agent/agent.module';

@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly processedMessages = new Set<string>();
  private readonly channelId = process.env.WHATSAPP_CHANNEL_ID || 'default-channel';

  constructor(
    private readonly whapiService: WhapiService,
    @Inject(AGENT_SERVICE) private readonly agentService: IAgentService,
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
    const userId = message.chat_id; // Use chat_id as unique user identifier

    this.logger.log(
      `[${requestId}] 📨 Processing message from ${senderPhone} (${message.chat_id}): "${originalMessage}"`
    );

    try {
      // Special commands
      if (originalMessage.toLowerCase() === '/clear') {
        this.agentService.clearHistory(userId);
        await this.whapiService.sendMessage(senderPhone, '🗑️ Conversation history cleared!');
        this.logger.log(`[${requestId}] ✅ History cleared for ${senderPhone}`);
        return;
      }

      if (originalMessage.toLowerCase() === '/stats') {
        const stats = this.agentService.getHistoryStats();
        const statsMessage = `📊 Stats:\n👥 Users: ${stats.totalUsers}\n💬 Messages: ${stats.totalMessages}`;
        await this.whapiService.sendMessage(senderPhone, statsMessage);
        this.logger.log(`[${requestId}] ✅ Stats sent to ${senderPhone}`);
        return;
      }

      // Show typing indicator
      await this.whapiService.setTyping(message.chat_id, true);
      this.logger.log(`[${requestId}] ⌨️  Typing indicator started`);

      // Process message with AI agent
      const aiResponse = await this.agentService.processMessage(userId, originalMessage, requestId);

      // Stop typing indicator
      await this.whapiService.setTyping(message.chat_id, false);

      // Send AI response back to WhatsApp
      const sent = await this.whapiService.sendMessage(senderPhone, aiResponse);

      if (sent) {
        this.logger.log(`[${requestId}] ✅ AI response sent to ${senderPhone}`);
      } else {
        this.logger.error(`[${requestId}] ❌ Failed to send AI response to ${senderPhone}`);
      }
    } catch (error) {
      this.logger.error(`[${requestId}] ❌ Error processing message: ${error.message}`, error.stack);
      
      // Stop typing indicator on error
      try {
        await this.whapiService.setTyping(message.chat_id, false);
      } catch (e) {
        // Ignore typing stop errors
      }
      
      // Send error message to user
      try {
        await this.whapiService.sendMessage(
          senderPhone, 
          '❌ Sorry, I encountered an error processing your message. Please try again.'
        );
      } catch (sendError) {
        this.logger.error(`[${requestId}] ❌ Failed to send error message: ${sendError.message}`);
      }
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