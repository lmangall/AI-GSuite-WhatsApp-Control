# NestJS Whapi WhatsApp Integration

NestJS (test) setup with Langhain to receive WhatsApp messages via webhooks, process them with various tools/agents and reply using the Whapi API.

- Webhook endpoint -> automatic reply

### Run and kill
It's just a weekend built demo so I am "testing in prod" the deploy.sh script is the best approach to quickly kill, pull, build, flush logs and deploy

## The human touch (UX)
One thing that was told by Limova team is that the personification of the agents was a game changer, having the 3 dots as if someone was writeing while the AI and server is processing is a game changer imo

### Webhook(s)

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
├── 
```

## Useful Whapi Documentation

- [Where to find the webhook URL](https://support.whapi.cloud/help-desk/receiving/webhooks/where-to-find-the-webhook-url)
- [API documentation](https://whapi.readme.io/reference/checkhealth)

