import { flowEngine } from './src/lib/flowEngine/flowEngine';

async function testFlow() {
  console.log('🧪 Testing complete flow...\n');
  
  let conversationId: string | null = null;
  
  // Step 1: User says "hi" (Hebrew)
  console.log('📝 Step 1: User says "היי"');
  const step1 = await flowEngine.processMessage({
    conversationId: null,
    message: 'היי',
    channel: 'web',
    stream: false,
  }).next();
  conversationId = step1.value?.conversationId || null;
  console.log(`✅ Response: ${step1.value?.finalText || 'No response'}\n`);
  
  // Step 2: User says they're from a nonprofit that hasn't registered and wants to build a campaign
  console.log('📝 Step 2: User says they want to register as nonprofit and build a campaign');
  const step2 = await flowEngine.processMessage({
    conversationId: conversationId!,
    message: 'אני מעמותה שלא רשומה ואני רוצה לבנות קמפיין עם צ\'רידי',
    channel: 'web',
    stream: false,
  }).next();
  console.log(`✅ Response: ${step2.value?.finalText || 'No response'}\n`);
  
  // Step 3: User provides registration details
  console.log('📝 Step 3: User provides registration details');
  const step3 = await flowEngine.processMessage({
    conversationId: conversationId!,
    message: 'אוריאל אהרוני 0502440556 uriel@facio.io 580722759',
    channel: 'web',
    stream: false,
  }).next();
  console.log(`✅ Response: ${step3.value?.finalText || 'No response'}\n`);
  
  // Step 4: User provides campaign details
  console.log('📝 Step 4: User provides campaign details');
  const step4 = await flowEngine.processMessage({
    conversationId: conversationId!,
    message: 'קמפיין לסיוע לבטיחות אש - מגייסים 3 מליון ש״ח בקמפיין ב5 בפברואר',
    channel: 'web',
    stream: false,
  }).next();
  console.log(`✅ Response: ${step4.value?.finalText || 'No response'}\n`);
  
  // Step 5: Check if user was moved to login flow
  console.log('📝 Step 5: Checking if user was moved to login flow...');
  const step5 = await flowEngine.processMessage({
    conversationId: conversationId!,
    message: 'test',
    channel: 'web',
    stream: false,
  }).next();
  console.log(`✅ Response: ${step5.value?.finalText || 'No response'}\n`);
  
  console.log('✅ Flow test completed!');
  console.log(`📊 Conversation ID: ${conversationId}`);
}

testFlow().catch(console.error);

