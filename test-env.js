#!/usr/bin/env node

// Simple test script to verify environment variable setup
require('dotenv').config();

console.log('🔍 Testing SureBet Pro Environment Configuration\n');

const requiredVars = [
  'FOOTBALL_DATA_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'HUGGINGFACE_API_KEY',
  'COHERE_API_KEY'
];

const optionalVars = [
  'DEFAULT_AI_PROVIDER',
  'DAILY_TARGET'
];

let hasRequired = false;
let missingRequired = [];
let configuredOptional = [];

console.log('📋 Required API Keys:');
requiredVars.forEach(key => {
  const value = process.env[key];
  if (value && value !== `your_${key.toLowerCase().replace('_', '_')}_here`) {
    console.log(`  ✅ ${key}: Configured`);
    hasRequired = true;
  } else {
    console.log(`  ❌ ${key}: Missing or placeholder`);
    missingRequired.push(key);
  }
});

console.log('\n📋 Optional Configuration:');
optionalVars.forEach(key => {
  const value = process.env[key];
  if (value) {
    console.log(`  ✅ ${key}: ${value}`);
    configuredOptional.push(key);
  } else {
    console.log(`  ⚠️  ${key}: Using default`);
  }
});

console.log('\n🎯 Summary:');
if (hasRequired) {
  console.log('✅ At least one AI API key is configured - predictions will work!');
} else {
  console.log('❌ No AI API keys configured - predictions will not work');
  console.log('   Please configure at least one AI provider API key');
}

if (missingRequired.length > 0) {
  console.log(`\n💡 Missing keys: ${missingRequired.join(', ')}`);
  console.log('   Get API keys from the respective provider websites');
}

console.log('\n🚀 Ready for deployment on Render!');
console.log('   Set these environment variables in your Render dashboard');