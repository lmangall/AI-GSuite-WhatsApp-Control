export class WebhookMessageDto {
  id: string;
  from_me: boolean;
  type: string;
  chat_id: string;
  timestamp: number;
  source: string;
  device_id: number;
  text?: {
    body: string;
  };
  from: string;
  from_name?: string;
  status?: string;
}

export class WebhookMessagesPayloadDto {
  messages: WebhookMessageDto[];
  channel_id: string;
}
