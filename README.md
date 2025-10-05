# NestJS Whapi WhatsApp Integration

Minimal NestJS (test) setup to receive WhatsApp messages via webhooks and reply using the Whapi API.

- Webhook endpoint -> automatic reply

### Run and kill


```bash
sudo pm2 start dist/main.js --name nestjs-whatsapp --update-env
```

```bash

sudo pm2 delete all
sudo pm2 flush
sudo lsof -i :3000
```

## API Endpoints

### Messages Webhook
`POST /:channelId/messages` - Handles incoming WhatsApp messages

### Chats Webhook
`PATCH /:channelId/chats` - Handles chat metadata updates

## Testing the server

Simulating a messages webhook request:

```bash
curl -X POST http://localhost:3000/YOUR_CHANNEL_ID/messages \
  -H "Content-Type: application/json" \
  -d '{
  "messages": [
    {
      "id": "test-message-123",
      "from_me": false,
      "type": "text",
      "chat_id": "1234567890@s.whatsapp.net",
      "timestamp": 1712995245,
      "device_id": 55,
      "text": {
        "body": "Hello from test"
      },
      "from_name": "Test User"
    }
  ],
  "channel_id": "YOUR_CHANNEL_ID"
}'

Via Whapi Dashboard
or
Via API

- [Set the webhook link to the channel](https://support.whapi.cloud/help-desk/receiving/webhooks/set-the-webhook-link-to-the-channel)

## Testing

Send a WhatsApp message to your connected number. You should see:

1. Logs in your terminal showing the received message
2. An automatic reply: `Received [your_message], triggered webhook`

## Structure

```
src/
├── main.ts                    # Application entry point
├── app.module.ts              # Root module
├── webhook/
│   └── webhook.controller.ts  # Webhook endpoint handler
└── whapi/
    └── whapi.service.ts       # Whapi API integration
```

## Useful Whapi Documentation

- [Where to find the webhook URL](https://support.whapi.cloud/help-desk/receiving/webhooks/where-to-find-the-webhook-url)
- [API documentation](https://whapi.readme.io/reference/checkhealth)

## Production Deployment

For production, replace the ngrok URL with domain, update  webhook configuration in Whapi

## Logs

- ✅ Successful operations
- 📥 Incoming webhooks
- 📨 Received messages
- ❌ Errors

## Troubleshooting

**Webhook not receiving messages:**
- Verify ngrok is running and the URL is correct
- Check that the webhook is properly configured in Whapi
- Ensure your Whapi channel status is "AUTH"

**Health check failing:**
- Verify `WHAPI_TOKEN` is correct in `.env`
- Check your channel status at `https://gate.whapi.cloud/health`

**Messages not being sent:**
- Check logs for error messages
- Verify the token has permission to send messages
- Ensure the recipient number is in correct format
