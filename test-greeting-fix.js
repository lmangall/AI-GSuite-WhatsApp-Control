// Quick test to verify greeting pattern matching
const testGreetingPatterns = () => {
  const simpleGreetings = [
    /^hi\s*jarvis?[!.]?$/i,
    /^hello\s*jarvis?[!.]?$/i,
    /^hey\s*jarvis?[!.]?$/i,
    /^yo\s*jarvis?[!.]?$/i,
    /^sup\s*jarvis?[!.]?$/i,
    /^hi[!.]?$/i,
    /^hello[!.]?$/i,
    /^hey[!.]?$/i,
  ];

  const testMessages = [
    "Hi Jarvis!",
    "Hello Jarvis",
    "Hey Jarvis!",
    "Hi!",
    "Hello",
    "hey",
    "Hi Jarvis.",
    "Hello there Jarvis!"
  ];

  console.log("Testing greeting patterns:");
  testMessages.forEach(message => {
    const matches = simpleGreetings.some(pattern => pattern.test(message.trim()));
    console.log(`"${message}" -> ${matches ? '✅ MATCH' : '❌ NO MATCH'}`);
  });

  // Test the greeting service pattern
  const greetingPatterns = [
    /^(hi|hello|hey|halo|hola|yo|sup|wassup)(\s+(there|dude|man|bro|jarvis))?[!.?]*$/i,
    /^(good\s+(morning|afternoon|evening|night))(\s+jarvis)?[!.?]*$/i,
    /^(how\s+(are\s+you|\'s\s+it\s+going))(\s+jarvis)?[?!.]*$/i,
    /^(what\'?s\s+up)(\s+jarvis)?[?!.]*$/i
  ];

  console.log("\nTesting greeting service patterns:");
  testMessages.forEach(message => {
    const matches = greetingPatterns.some(pattern => pattern.test(message.trim()));
    console.log(`"${message}" -> ${matches ? '✅ MATCH' : '❌ NO MATCH'}`);
  });
};

testGreetingPatterns();