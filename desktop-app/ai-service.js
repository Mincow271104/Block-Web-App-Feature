/* ===== Focus Guard — AI Service Module =====
   Handles Ollama (local) and Groq (cloud) LLM connections
   for Tier 2 video classification.
*/

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const AWS_API_URL = 'https://j8g2zltrl4.execute-api.ap-southeast-2.amazonaws.com/dev';
const COGNITO_USER_ID = 'default-user'; // Stub for Phase 1

let memorySettings = {
  allowedCategories: ['Education', 'Science & Technology'],
  groqApiKey: ''
};

async function initAWS() {
  try {
    const res = await httpRequest(`${AWS_API_URL}/settings/${COGNITO_USER_ID}`, { method: 'GET', timeout: 5000 });
    if (res.status === 200 && res.data) {
      if (res.data.allowedCategories) memorySettings.allowedCategories = res.data.allowedCategories;
      if (res.data.groqApiKey) memorySettings.groqApiKey = res.data.groqApiKey;
      console.log('[AWS] Settings loaded from Cloud');
    }
  } catch(e) {
    console.error('[AWS] Failed to load settings:', e.message);
  }
}

function syncToAWS() {
  httpRequest(`${AWS_API_URL}/settings/${COGNITO_USER_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }, memorySettings).catch(e => console.error('[AWS] Sync failed:', e.message));
}

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const OLLAMA_MODEL = 'qwen3:14b';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ===== Classification Prompt =====
const SYSTEM_PROMPT = `You are a strict YouTube content filter for a productivity application. 
Your primary objective is to classify whether a video is strictly for study/educational purposes or if it contains entertainment elements that would distract a student during a study session.

TASK: Classify the video as "ALLOW" (educational/study content) or "BLOCK" (entertainment/distracting).

STRICT RULES:
1. ALLOW: Videos that are purely educational, scientific, programming tutorials, academic lectures, TED talks, educational documentaries, or credible news.
2. BLOCK: Music (including lo-fi, study music, relax music, ambient, etc.), Gaming, Movies, Anime, Comedy, Vlogs, Reaction videos, Mukbang, Drama, Sports, ASMR, and any general entertainment.
3. EDUTAINMENT: If a video blends education with high entertainment value (e.g., Kurzgesagt, Vsauce, Mark Rober), it is generally ALLOWED, provided the primary focus is learning.
4. MUSIC EXCEPTION: ALL music videos must be BLOCKED, even if titled "study music", "relaxing sounds", or "concentration mix".
5. AMBIGUITY: If you are uncertain or the video metadata is vague, default to "BLOCK" for the user's safety.

OUTPUT FORMAT:
Respond ONLY with a valid JSON object. Do not include markdown code blocks, explanations, or any extra text.
{"result": "ALLOW" or "BLOCK", "reason": "Short explanation in English (max 20 words)"}`;

function buildUserPrompt(metadata) {
  let prompt = `Classify the following YouTube video:\n`;
  prompt += `- Title: ${metadata.title || 'N/A'}\n`;
  prompt += `- Channel/Author: ${metadata.author || 'N/A'}\n`;
  prompt += `- YouTube Category: ${metadata.category || 'N/A'}\n`;
  if (metadata.keywords && metadata.keywords.length > 0) {
    prompt += `- Keywords: ${metadata.keywords.slice(0, 10).join(', ')}\n`;
  }
  if (metadata.description) {
    // Truncate description to first 300 chars
    let desc = metadata.description.replace(/\s+/g, ' ').trim();
    prompt += `- Description: ${desc.substring(0, 300)}\n`;
  }
  return prompt;
}

// ===== HTTP Helpers =====
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const headers = { ...options.headers };
    if (bodyString) {
      headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: headers,
      timeout: options.timeout || 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (e) => {
      console.error('[AI] HTTP error:', e.message);
      reject(e);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyString) req.write(bodyString);
    req.end();
  });
}

// ===== Ollama =====
async function checkOllama() {
  try {
    // console.log('[AI] Checking Ollama at', OLLAMA_BASE + '/api/tags');
    const res = await httpRequest(`${OLLAMA_BASE}/api/tags`, { method: 'GET', timeout: 5000 });
    // console.log('[AI] Ollama response status:', res.status, 'models:', res.data?.models?.map(m => m.name));
    if (res.status === 200 && res.data && res.data.models) {
      const hasModel = res.data.models.some(m => m.name && m.name.startsWith('qwen3'));
      return { available: true, hasModel, models: res.data.models.map(m => m.name) };
    }
    return { available: false, hasModel: false, models: [] };
  } catch (e) {
    // console.error('[AI] Ollama check failed:', e.message);
    return { available: false, hasModel: false, models: [] };
  }
}

async function classifyWithOllama(metadata) {
  const userPrompt = buildUserPrompt(metadata);
  const res = await httpRequest(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000 // 2 minutes (local models take time to load)
  }, {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    stream: false,
    options: { temperature: 0.1 }
  });

  if (res.status === 200 && res.data && res.data.message) {
    return parseAiResponse(res.data.message.content);
  }
  throw new Error(`Ollama error: ${res.status}`);
}

// ===== Settings =====
function getAllowedCategories() {
  return memorySettings.allowedCategories;
}

function saveAllowedCategories(cats) {
  memorySettings.allowedCategories = cats;
  syncToAWS();
}

// ===== Groq =====
function getGroqKey() {
  return memorySettings.groqApiKey;
}

function saveGroqKey(key) {
  memorySettings.groqApiKey = key;
  syncToAWS();
}

async function checkGroq() {
  const key = getGroqKey();
  if (!key) return { available: false, reason: 'no_key' };

  try {
    const res = await httpRequest(`${GROQ_BASE}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${key}` },
      timeout: 5000
    });
    if (res.status === 200) return { available: true };
    if (res.status === 401) return { available: false, reason: 'invalid_key' };
    return { available: false, reason: `http_${res.status}` };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

async function classifyWithGroq(metadata) {
  const key = getGroqKey();
  if (!key) throw new Error('No Groq API key');

  const userPrompt = buildUserPrompt(metadata);
  const res = await httpRequest(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    timeout: 15000
  }, {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,
    max_tokens: 150
  });

  if (res.status === 200 && res.data && res.data.choices && res.data.choices[0]) {
    return parseAiResponse(res.data.choices[0].message.content);
  }
  throw new Error(`Groq error: ${res.status}`);
}

// ===== Unified API =====
function parseAiResponse(text) {
  try {
    // Try to extract JSON from the response (handles markdown code blocks too)
    const jsonMatch = text.match(/\{[\s\S]*?"result"\s*:\s*"(ALLOW|BLOCK)"[\s\S]*?\}/i);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        result: parsed.result.toUpperCase(),
        reason: parsed.reason || ''
      };
    }
  } catch { /* fall through */ }

  // Fallback: look for ALLOW/BLOCK keywords
  const upper = text.toUpperCase();
  if (upper.includes('ALLOW')) return { result: 'ALLOW', reason: text.substring(0, 100) };
  if (upper.includes('BLOCK')) return { result: 'BLOCK', reason: text.substring(0, 100) };

  // Default to BLOCK if cannot parse
  return { result: 'BLOCK', reason: 'Could not parse AI response' };
}

async function classifyVideo(metadata) {
  // Try Ollama first (free, local)
  try {
    const ollama = await checkOllama();
    if (ollama.available && ollama.hasModel) {
      console.log('[AI] Classifying with Ollama...');
      const result = await classifyWithOllama(metadata);
      console.log('[AI] Ollama result:', result);
      return { ...result, provider: 'ollama' };
    }
  } catch (e) {
    console.warn('[AI] Ollama classification failed:', e.message);
  }

  // Fallback to Groq
  try {
    const groq = await checkGroq();
    if (groq.available) {
      console.log('[AI] Classifying with Groq...');
      const result = await classifyWithGroq(metadata);
      console.log('[AI] Groq result:', result);
      return { ...result, provider: 'groq' };
    }
  } catch (e) {
    console.warn('[AI] Groq classification failed:', e.message);
  }

  // No AI available → default BLOCK
  return { result: 'BLOCK', reason: 'No AI provider available', provider: 'none' };
}

async function getAiStatus() {
  const [ollama, groq] = await Promise.all([checkOllama(), checkGroq()]);
  const activeProvider = (ollama.available && ollama.hasModel) ? 'ollama'
    : groq.available ? 'groq' : 'none';
  return {
    ollama,
    groq,
    activeProvider,
    ready: activeProvider !== 'none'
  };
}

module.exports = {
  initAWS,
  checkOllama,
  checkGroq,
  getGroqKey,
  saveGroqKey,
  getAllowedCategories,
  saveAllowedCategories,
  classifyVideo,
  getAiStatus
};
