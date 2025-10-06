Jarvis - WhatsApp AI Agent with Google Workspace Integration

Jarvis is your personal AI assistant accessible through WhatsApp, capable of managing your entire Google Workspace, performing web searches, and engaging in natural conversations.

**Featuring:**
 🪺 NestJS - *dependency injection go brrr~*
 🍆 MCP - *oh yeah, we're that cutting edge*
 🦜 LangChain - *one AI call is never enough*
 🌐 Fully Deployed - *not on localhost, actual internet*
 📱 WhatsApp - *building a UI is for you know, front-end people*


 The agent have his own Google Calendar and it can be used as a personification of the agent, to make it more tangible but also have an overview of the scheduled tasks. The agent can decide alone to add to its calendar

## Discovery Steps:

### Phase 1: Individual Testing & Validation

- **WhatsApp API** → [nestjs-whatsapp](https://github.com/lmangall/nestjs-whatsapp) - Webhook reception and message sending
- **MCP Server** → [google_workspace_mcp](https://github.com/lmangall/google_workspace_mcp) - Deployed to Render
- **Google OAuth 2.0** 
- **MCP Client** → [nestjs-mcp-client-test](https://github.com/lmangall/nestjs-mcp-client-test) - NestJS wrapper to communicate with MCP server

### Phase 2: Integration

- Connected all tested modules under a single Nestjs
- Established WhatsApp → NestJS → MCP communication pipeline
- Added **Brave Search API** for web search
- Implemented error handling and fallback mechanisms

### Phase 3: LangChain, Enhancement

- **~20 Integrated Tools in total **
- **Intent Detection** - Smart routing (avoid agentic flow to answer fast)
- **Memory Management**
- **Dual AI Architecture** - Gemini (primary) and OpenAI (fallback) or env var driven


##  Features

- **WhatsApp Integration**: Receive and respond to messages via Whapi API webhooks
- **Google Workspace Control**: 
  - Read and create Gmail emails
  - Manage Google Drive documents
  - Schedule and view Calendar events
  - All the rest (sheets....)
- **AI Capabilities**:
  - Web search (Brave API)
  - Intent detection and routing
  - Context-aware responses with memory management
  - ~20 integrated tools
- **Agent Personification**: The AI agent maintains its own Google Calendar for task tracking and scheduling
- **Dual AI Support**: Primary (Gemini) and fallback (OpenAI) models

### Future improvements
Enterprise standard with multi tenant: this will necessitate to have a more advanced auth, manage users in a db...


### Run and kill
It's just a weekend built demo so I am "testing in prod". I ssh into the EC2 on a terminal but code in a local IDE (less buggy), so the deploy.sh script is the best approach to quickly kill, pull, build, flush logs and deploy

## The UX touch ✨
Limova team communicated that the personification of the agents was a game changer. I added WhatsApp typing indicators ("three dots") while processing requests, This way users "waits" more easilly, but also it gives a great feeling



### Webhook(s)

## Flow

WhatsApp Message (webhook) → Agent Factory → LangChain Agent → Intent Detection → Agent Executor
           ↑                                                                           ↓
WhatsApp Message (API)   ←   Memory  ←  Prompt Manager  ←  Tool Manager  ←  Tools (MCP, Brave)

## Structure

```
src/
├── 
```

## Stack
This repo is Nestjs (so Node, js and ts under the hood) it uses Langchain for more scalable AI agentic approach
The MCP is a Python 3 ([google_workspace_mcp](https://github.com/taylorwilsdon/google-workspace-mcp))


## Infra

EC2 instance : deployment of this repo (pm2)
Render : deployment of the MCP as a python 3 webservice
Whapi API instead of a front-end (official API from meta necessitates business verification (no time for this 3 day work))




## Acknowledgments

- MCP server implementation by [@taylorwilsdon](https://github.com/taylorwilsdon)
- Inspired by the product-market fit success of Limmova.ai
- Motivated by the opportunity to learn fast and apply at a cool startup



## Documentation

- [OpenAI MCP Documentation](https://platform.openai.com/docs/mcp)
- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Whapi Webhooks Guide](https://support.whapi.cloud/help-desk/receiving/webhooks/where-to-find-the-webhook-url)
- [Whapi API Reference](https://whapi.readme.io/reference/checkhealth)
- [LangChain Documentation](https://js.langchain.com/docs/)



## 🏷️ Tech Stack

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![LangChain](https://img.shields.io/badge/🦜_LangChain-2C3E50?style=for-the-badge)
![MCP](https://img.shields.io/badge/MCP-6366F1?style=for-the-badge&logo=protocol&logoColor=white)
![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![AWS](https://img.shields.io/badge/AWS_EC2-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)