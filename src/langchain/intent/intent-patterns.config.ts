import { IntentPattern } from '../interfaces/langchain-config.interface';

/**
 * Default intent patterns configuration
 */
export const DEFAULT_INTENT_PATTERNS: IntentPattern[] = [
  // Greeting Intent Patterns (Highest Priority - Fast Response)
  {
    intent: 'greeting',
    priority: 4,
    keywords: [
      'hi', 'hello', 'hey', 'halo', 'hola', 'bonjour', 'salut',
      'good morning', 'good afternoon', 'good evening', 'good night',
      'howdy', 'greetings', 'sup', 'what\'s up', 'whats up',
      'yo', 'wassup', 'how are you', 'how\'s it going'
    ],
    patterns: [
      /^(hi|hello|hey|halo|hola|yo|sup|wassup)!?$/i,
      /^(good\s+(morning|afternoon|evening|night))!?$/i,
      /^(how\s+(are\s+you|\'s\s+it\s+going))[\?\!]?$/i,
      /^(what\'?s\s+up)[\?\!]?$/i
    ]
  },

  // Web Search Intent Patterns (High Priority)
  {
    intent: 'web_search',
    priority: 3,
    keywords: [
      // Search-related keywords
      'search', 'google', 'find', 'look up', 'lookup',
      
      // Information seeking
      'what is', 'what are', 'who is', 'who are', 'where is', 'where are',
      'when is', 'when did', 'when will', 'how much', 'how many',
      
      // Current/real-time information
      'latest', 'current', 'recent', 'now', 'today', 'this week',
      'breaking', 'news', 'update', 'updates',
      
      // Weather-related
      'weather', 'temperature', 'forecast', 'climate', 'rain', 'snow',
      'sunny', 'cloudy', 'storm', 'hurricane',
      
      // Financial/market data
      'stock', 'price', 'market', 'trading', 'crypto', 'bitcoin',
      'exchange rate', 'currency', 'nasdaq', 'dow jones',
      
      // Sports
      'sports', 'score', 'game', 'match', 'tournament', 'championship',
      'football', 'basketball', 'soccer', 'baseball', 'tennis',
      
      // Technology/trends
      'trending', 'viral', 'popular', 'top rated', 'best of',
      
      // Location-based
      'near me', 'nearby', 'local', 'in my area'
    ],
    patterns: [
      // Question patterns
      /\b(what|who|where|when|how|why)\s+(is|are|was|were|will|did|does|do)\b/i,
      /\b(search|find|look up|lookup)\s+(for\s+)?(.+)/i,
      /\b(latest|current|recent)\s+(news|information|updates?)\s+(about|on|for)\b/i,
      /\b(what'?s|whats)\s+(the\s+)?(latest|current|news|weather|price|score)\b/i,
      /\b(how much|how many)\s+(is|are|does|do|did|will)\b/i,
      /\b(weather|temperature|forecast)\s+(in|for|at|today|tomorrow)\b/i,
      /\b(stock|price|market)\s+(of|for|today|now)\b/i,
      /\b(sports?|game|match)\s+(score|result|today|tonight)\b/i
    ]
  },

  // MCP Tools Intent Patterns (Medium Priority)
  {
    intent: 'mcp_tools',
    priority: 2,
    keywords: [
      // Email-related
      'send email', 'email', 'mail', 'compose', 'message', 'reply',
      'forward', 'inbox', 'outbox', 'draft',
      
      // Calendar/scheduling
      'schedule', 'calendar', 'appointment', 'meeting', 'event',
      'book', 'reserve', 'plan', 'arrange', 'set up',
      'remind', 'reminder', 'alert', 'notification',
      
      // Task management
      'create task', 'add task', 'task', 'todo', 'to-do',
      'assign', 'complete', 'finish', 'done', 'check off',
      'project', 'deadline', 'due date',
      
      // Note-taking
      'note', 'notes', 'write down', 'save', 'record',
      'document', 'memo', 'jot down', 'remember',
      
      // File/document management
      'create file', 'save file', 'upload', 'download',
      'share', 'collaborate', 'edit', 'modify',
      
      // Action verbs
      'create', 'add', 'make', 'new', 'generate',
      'update', 'modify', 'change', 'edit', 'delete', 'remove'
    ],
    patterns: [
      // Email patterns
      /\b(send|compose|write|reply to|forward)\s+(an?\s+)?(email|message|mail)\b/i,
      /\b(email|mail|message)\s+(to|for)\s+(.+)/i,
      
      // Calendar patterns
      /\b(schedule|book|arrange|set up)\s+(an?\s+)?(meeting|appointment|call|event)\b/i,
      /\b(add|create)\s+(to\s+)?(calendar|schedule)\b/i,
      /\b(remind|set reminder)\s+(me\s+)?(to|about|for)\b/i,
      
      // Task patterns
      /\b(create|add|make)\s+(a\s+)?(task|todo|to-do)\b/i,
      /\b(add\s+to|create\s+in)\s+(tasks?|todo|to-do)\s+(list|app)\b/i,
      
      // Note patterns
      /\b(write|create|make|save)\s+(a\s+)?(note|memo)\b/i,
      /\b(note|write down|jot down|record)\s+(that|this)\b/i,
      
      // General action patterns
      /\b(create|add|make|generate)\s+(new\s+)?(.+)\s+(in|to|for)\b/i,
      /\b(save|store|keep)\s+(this|that|it)\s+(in|to|for)\b/i
    ]
  },

  // General Chat Intent Patterns (Low Priority - Catch-all)
  {
    intent: 'general_chat',
    priority: 1,
    keywords: [
      // Greetings
      'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
      'greetings', 'howdy', 'what\'s up', 'whats up',
      
      // Gratitude
      'thanks', 'thank you', 'appreciate', 'grateful',
      
      // Help/assistance
      'help', 'assist', 'support', 'guide', 'explain',
      'tell me', 'show me', 'teach me', 'how to',
      
      // Conversational
      'what do you think', 'opinion', 'advice', 'suggest',
      'recommend', 'idea', 'thoughts', 'perspective',
      
      // Knowledge/explanation
      'explain', 'describe', 'define', 'meaning', 'concept',
      'understand', 'clarify', 'elaborate', 'detail',
      
      // Casual conversation
      'chat', 'talk', 'discuss', 'conversation', 'tell me about',
      'interesting', 'cool', 'awesome', 'amazing'
    ],
    patterns: [
      // Greeting patterns
      /\b(hello|hi|hey|good\s+(morning|afternoon|evening))\b/i,
      /\b(what'?s\s+up|whats\s+up|how\s+are\s+you|how\s+do\s+you\s+do)\b/i,
      
      // Help patterns
      /\b(help|assist|support)\s+(me\s+)?(with|to|in)?\b/i,
      /\b(can\s+you|could\s+you|would\s+you)\s+(help|assist|explain|tell|show)\b/i,
      
      // Explanation patterns
      /\b(explain|describe|define|tell\s+me\s+about)\s+(.+)/i,
      /\b(what\s+is|what\s+are)\s+(.+)\s*\??\s*$/i,
      /\b(how\s+does|how\s+do|how\s+can)\s+(.+)\s+(work|function|operate)\b/i,
      
      // Opinion/advice patterns
      /\b(what\s+do\s+you\s+think|opinion|advice|suggest|recommend)\b/i,
      /\b(should\s+i|would\s+you|do\s+you\s+think)\b/i,
      
      // Conversational patterns
      /\b(let'?s\s+)?(chat|talk|discuss)\s+(about)?\b/i,
      /\b(tell\s+me\s+something|something\s+interesting)\b/i
    ]
  }
];

/**
 * Intent confidence thresholds
 */
export const INTENT_CONFIDENCE_THRESHOLDS = {
  HIGH_CONFIDENCE: 0.8,
  MEDIUM_CONFIDENCE: 0.5,
  LOW_CONFIDENCE: 0.3,
  FALLBACK_THRESHOLD: 0.2
};

/**
 * Tool suggestions for each intent type
 */
export const INTENT_TOOL_MAPPING = {
  web_search: ['brave_search'],
  mcp_tools: {
    email: ['email', 'gmail', 'outlook'],
    calendar: ['calendar', 'google_calendar', 'outlook_calendar'],
    tasks: ['tasks', 'todo', 'trello', 'asana'],
    notes: ['notes', 'notion', 'evernote', 'onenote'],
    files: ['drive', 'dropbox', 'onedrive'],
    general: ['mcp_general']
  },
  general_chat: [],
  greeting: [] // No tools needed for greetings - direct response
};

/**
 * Web search query optimization patterns
 */
export const SEARCH_QUERY_PATTERNS = {
  // Patterns to remove from search queries
  REMOVE_PATTERNS: [
    /^(search\s+for\s+|search\s+|look\s+up\s+|find\s+|what\s+is\s+|what\s+are\s+)/i,
    /^(tell\s+me\s+about\s+|information\s+about\s+|latest\s+|current\s+)/i,
    /^(news\s+about\s+|how\s+much\s+is\s+|how\s+many\s+)/i,
    /\s*\?+\s*$/g // Remove trailing question marks
  ],
  
  // Patterns to enhance search queries
  ENHANCE_PATTERNS: {
    weather: (location: string) => `weather forecast ${location}`,
    stock: (symbol: string) => `${symbol} stock price today`,
    news: (topic: string) => `latest news ${topic}`,
    sports: (query: string) => `${query} score today`
  }
};