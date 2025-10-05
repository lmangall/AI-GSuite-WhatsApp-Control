import { WebhookMessageDto } from './webhook-message.dto';

export class ChatUpdateDto {
  id: string;
  type: string;
  timestamp: number;
  unread: number;
  not_spam: boolean;
  last_message?: WebhookMessageDto;
  name?: string;
}

export class WebhookChatUpdateDto {
  before_update: ChatUpdateDto;
  after_update: ChatUpdateDto;
  changes: string[];
}

export class WebhookChatsPayloadDto {
  chats_updates: WebhookChatUpdateDto[];
  channel_id: string;
}
