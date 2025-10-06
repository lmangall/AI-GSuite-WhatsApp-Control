// Simple test script to verify fast routing works
const testMessages = [
  'hi',
  'hello',
  'hey there',
  'what can you do',
  'help me',
  'thanks',
  'thank you',
  'ok',
  'cool',
  'search for latest news about AI',
  'send an email to john@example.com',
  'check my emails',
  'what is the weather today'
];

console.log('🧪 Testing fast routing patterns...\n');

// Simulate the fast routing logic
function isSimpleGreeting(message) {
  const simpleGreetings = [
    'hi', 'hello', 'hey', 'halo', 'hola', 'yo', 'sup', 'wassup',
    'good morning', 'good afternoon', 'good evening', 'good night',
    'hey there', 'hello there', 'hi there', 'howdy', 'greetings'
  ];

  const normalizedMessage = message.toLowerCase().trim();
  
  // Exact matches
  if (simpleGreetings.some(greeting => 
    normalizedMessage === greeting || 
    normalizedMessage === greeting + '!' ||
    normalizedMessage === greeting + '.'
  )) {
    return true;
  }

  // Pattern matches for variations
  const greetingPatterns = [
    /^(hi|hello|hey|halo|hola|yo|sup|wassup)(\s+(there|dude|man|bro))?[!.]?$/i,
    /^(good\s+(morning|afternoon|evening|night))[!.]?$/i,
    /^(how\s+(are\s+you|\'s\s+it\s+going))[?!.]?$/i,
    /^(what\'?s\s+up)[?!.]?$/i
  ];

  return greetingPatterns.some(pattern => pattern.test(normalizedMessage));
}

function isCapabilityQuestion(message) {
  const capabilityPatterns = [
    /what can you do/i,
    /what do you do/i,
    /help me/i,
    /what are your capabilities/i,
    /what features/i,
    /how can you help/i
  ];
  
  return capabilityPatterns.some(pattern => pattern.test(message));
}

function isThankYou(message) {
  const thankYouPatterns = [
    /^thanks?!?$/i,
    /^thank you!?$/i,
    /^ty!?$/i,
    /^thx!?$/i
  ];
  
  const normalizedMessage = message.toLowerCase().trim();
  return thankYouPatterns.some(pattern => pattern.test(normalizedMessage));
}

function isAffirmation(message) {
  const affirmationPatterns = [
    /^(ok|okay|alright|cool|nice|great|awesome|perfect)!?$/i,
    /^got it!?$/i,
    /^understood!?$/i,
    /^sounds good!?$/i
  ];
  
  const normalizedMessage = message.toLowerCase().trim();
  return affirmationPatterns.some(pattern => pattern.test(normalizedMessage));
}

function shouldUseFastPath(message) {
  return isSimpleGreeting(message) || 
         isCapabilityQuestion(message) || 
         isThankYou(message) || 
         isAffirmation(message);
}

testMessages.forEach(message => {
  const fastPath = shouldUseFastPath(message);
  const type = isSimpleGreeting(message) ? 'greeting' :
               isCapabilityQuestion(message) ? 'capability' :
               isThankYou(message) ? 'thanks' :
               isAffirmation(message) ? 'affirmation' : 'complex';
  
  const icon = fastPath ? '⚡' : '🔄';
  const path = fastPath ? 'FAST' : 'COMPLEX';
  
  console.log(`${icon} "${message}" → ${path} (${type})`);
});

console.log('\n✅ Fast routing test completed!');
console.log('⚡ Fast-path messages will respond instantly without loading tools');
console.log('🔄 Complex messages will use full agent processing with tools');