import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GreetingResponseService {
  private readonly logger = new Logger(GreetingResponseService.name);

  /**
   * Generate a casual greeting response with capabilities overview
   */
  generateGreetingResponse(userMessage: string): string {
    const greetings = [
      "Jarvis, at your service! 👋",
      "Hey Leo! What's up? 🤖",
      "Jarvis here, ready to help! 💪",
      "Hello there! Jarvis reporting for duty! ⚡"
    ];

    const capabilities = [
  "I can help you with:",
  "• 📧 **Google Workspace** - Gmail, Calendar, Docs, Sheets, Drive",
  "• 🗓️ **Assistant management** - Manage my own calendar and schedule tasks",
  "• 🔍 **Web Research** - Current info, news, weather, anything online", 
  "• 💬 **General Knowledge** - Questions, explanations, casual chat",
  "",
  "Just tell me what you need!"
];


    // Pick a random greeting
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    
    // Combine greeting with capabilities
    return [greeting, "", ...capabilities].join('\n');
  }

  /**
   * Generate a quick greeting without full capabilities (for follow-up greetings)
   */
  generateQuickGreeting(userMessage: string): string {
    const quickGreetings = [
      "Hey Leo! 👋",
      "Yo! What's up? 🤖", 
      "Hey! How can I help? 💪",
      "Sup! Need anything? ⚡",
      "Hey there! What do you need? 🚀",
      "Hi! Ready when you are 👍",
      "Yo Leo! What's the plan? 🎯"
    ];

    return quickGreetings[Math.floor(Math.random() * quickGreetings.length)];
  }

  /**
   * Determine if this should be a full greeting or quick greeting
   */
  shouldShowFullGreeting(userMessage: string, conversationHistory?: any[]): boolean {
    // Show full greeting if:
    // 1. No conversation history (first interaction)
    // 2. Last interaction was more than 1 hour ago
    // 3. User explicitly asks what Jarvis can do
    
    if (!conversationHistory || conversationHistory.length === 0) {
      return true;
    }

    // Check if user is asking about capabilities
    const message = userMessage.toLowerCase();
    if (message.includes('what can you do') || 
        message.includes('help me') || 
        message.includes('what do you do')) {
      return true;
    }

    // Check time since last interaction (if available)
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage && lastMessage.timestamp) {
      const timeDiff = Date.now() - new Date(lastMessage.timestamp).getTime();
      const oneHour = 60 * 60 * 1000;
      if (timeDiff > oneHour) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate contextual greeting based on time of day
   */
  generateContextualGreeting(): string {
    const hour = new Date().getHours();
    let timeGreeting = "";

    if (hour < 12) {
      timeGreeting = "Good morning";
    } else if (hour < 17) {
      timeGreeting = "Good afternoon";  
    } else {
      timeGreeting = "Good evening";
    }

    const responses = [
      `${timeGreeting}, Leo! Jarvis here 👋`,
      `${timeGreeting}! Ready to help with whatever you need 🤖`,
      `${timeGreeting}, dude! What's on the agenda? ⚡`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Check if message is a simple greeting
   */
  isSimpleGreeting(message: string): boolean {
    const simpleGreetings = [
      'hi', 'hello', 'hey', 'halo', 'hola', 'yo', 'sup', 'wassup',
      'good morning', 'good afternoon', 'good evening', 'good night',
      'hey there', 'hello there', 'hi there', 'howdy', 'greetings'
    ];

    const normalizedMessage = message.toLowerCase().trim().replace(/[!.?]+$/, '');
    
    // Exact matches (with or without punctuation)
    if (simpleGreetings.some(greeting => 
      normalizedMessage === greeting ||
      normalizedMessage === greeting + ' jarvis' ||
      normalizedMessage === greeting + ' jarvis!'
    )) {
      return true;
    }

    // Pattern matches for variations (including "jarvis" variations)
    const greetingPatterns = [
      /^(hi|hello|hey|halo|hola|yo|sup|wassup)(\s+(there|dude|man|bro|jarvis))?[!.?]*$/i,
      /^(good\s+(morning|afternoon|evening|night))(\s+jarvis)?[!.?]*$/i,
      /^(how\s+(are\s+you|\'s\s+it\s+going))(\s+jarvis)?[?!.]*$/i,
      /^(what\'?s\s+up)(\s+jarvis)?[?!.]*$/i
    ];

    return greetingPatterns.some(pattern => pattern.test(message.trim()));
  }
}