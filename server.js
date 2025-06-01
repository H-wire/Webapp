require('dotenv').config();
const express = require('express');
const axios = require('axios');
const dayjs = require('dayjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const PORT = 3001;
const LLM_API_URL = process.env.LLM_API_URL || 'http://192.168.1.122:11434/api/chat';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen3:8b';

// In-memory cache for LLM responses
const llmCache = new Map();
const CACHE_EXPIRY_HOURS = 24; // Cache expires after 24 hours

// Generate cache key based on request content
function generateCacheKey(ticker, goldenCrossDate, increasePercent, sector) {
  const keyString = `${ticker}-${goldenCrossDate}-${increasePercent}-${sector}`;
  return crypto.createHash('md5').update(keyString).digest('hex');
}

// Check if cache entry is still valid
function isCacheValid(cacheEntry) {
  const now = Date.now();
  const expiryTime = cacheEntry.timestamp + (CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
  return now < expiryTime;
}

// Load cache from file on startup
function loadCacheFromFile() {
  try {
    if (fs.existsSync('llm-cache.json')) {
      const cacheData = JSON.parse(fs.readFileSync('llm-cache.json', 'utf8'));
      Object.entries(cacheData).forEach(([key, value]) => {
        if (isCacheValid(value)) {
          llmCache.set(key, value);
        }
      });
      console.log(`Loaded ${llmCache.size} valid cache entries`);
    }
  } catch (err) {
    console.error('Failed to load cache from file:', err.message);
  }
}

// Save cache to file
function saveCacheToFile() {
  try {
    const cacheData = Object.fromEntries(llmCache);
    fs.writeFileSync('llm-cache.json', JSON.stringify(cacheData, null, 2));
  } catch (err) {
    console.error('Failed to save cache to file:', err.message);
  }
}

// Load cache on startup
loadCacheFromFile();

// OpenAI API logging function
function logToFile(type, data) {
  const timestamp = new Date().toISOString();
  const logEntry = `\n[${timestamp}] ${type}:\n${JSON.stringify(data, null, 2)}\n${'='.repeat(80)}\n`;
  fs.appendFileSync('openai-api.log', logEntry);
}

// Middleware to parse JSON bodies
app.use(express.json());

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/chartdata', async (req, res) => {
  const ticker = req.query.ticker || 'AAPL';
  const period = req.query.period || '1Y';

  // Always fetch 5 years of data for consistent MA calculations
  const now = dayjs();
  const fetchStart = now.subtract(5, 'year').format('YYYY-MM-DD');

  // Determine the period range to return to the client
  let filterStart;
  switch (period) {
    case '6M':
      filterStart = now.subtract(6, 'month').format('YYYY-MM-DD');
      break;
    case '1Y':
      filterStart = now.subtract(1, 'year').format('YYYY-MM-DD');
      break;
    case '2Y':
      filterStart = now.subtract(2, 'year').format('YYYY-MM-DD');
      break;
    case '5Y':
      filterStart = fetchStart;
      break;
    default:
      filterStart = now.subtract(1, 'year').format('YYYY-MM-DD');
  }

  try {
    const response = await axios.get(`https://api.tiingo.com/tiingo/daily/${ticker}/prices`, {
      params: {
        startDate: fetchStart,
        resampleFreq: 'daily',
        format: 'json',
        token: process.env.TIINGO_API_KEY
      }
    });

    const data = response.data.map(d => ({
      date: dayjs(d.date).format('YYYY-MM-DD'),
      close: d.close
    }));

    const calculateMA = (arr, window) =>
      arr.map((val, idx) => {
        if (idx < window - 1) return { ...val, [`ma${window}`]: null };
        const avg = arr.slice(idx - window + 1, idx + 1).reduce((sum, v) => sum + v.close, 0) / window;
        return { ...val, [`ma${window}`]: avg };
      });

    const ma50 = calculateMA(data, 50);
    const ma200 = calculateMA(data, 200);

    // Merge MA values so both are based on the full 5y history
    const merged = data.map((d, idx) => ({
      ...d,
      ma50: ma50[idx].ma50,
      ma200: ma200[idx].ma200
    }));

    // Filter to requested period while keeping MA values from 5y data
    const filtered = merged.filter(d => dayjs(d.date).isAfter(filterStart) || d.date === filterStart);
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch or process data.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { ticker, goldenCrossDate, increasePercent, sector, data } = req.body;
  
  // Generate cache key
  const cacheKey = generateCacheKey(ticker, goldenCrossDate, increasePercent, sector);
  
  // Check cache first
  if (llmCache.has(cacheKey)) {
    const cachedEntry = llmCache.get(cacheKey);
    if (isCacheValid(cachedEntry)) {
      console.log(`Cache HIT for ${ticker} (${cacheKey})`);
      logToFile('CACHE_HIT', {
        ticker: ticker,
        cacheKey: cacheKey,
        timestamp: new Date().toISOString()
      });
      return res.json(cachedEntry.response);
    } else {
      // Remove expired entry
      llmCache.delete(cacheKey);
    }
  }

  console.log(`Cache MISS for ${ticker} (${cacheKey})`);
  
  const prompt = `Given a golden cross occurred on ${goldenCrossDate} for ${ticker}, analyze the probability that the stock increases ${increasePercent}% in 30, 60 and 90 days. Group results by sector tag ${sector} and discuss false positives. Use the following data: ${JSON.stringify(data)}`;

  const requestPayload = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: 'You are a financial analysis assistant.' },
      { role: 'user', content: prompt }
    ],
    "think": false,
    "stream": false
  };

  try {
    // Log the request
    logToFile('REQUEST', {
      url: LLM_API_URL,
      payload: requestPayload,
      ticker: ticker,
      cacheKey: cacheKey,
      timestamp: new Date().toISOString()
    });

    const response = await axios.post(LLM_API_URL, requestPayload);
    
    // Log the response
    logToFile('RESPONSE', {
      status: response.status,
      data: response.data,
      ticker: ticker,
      cacheKey: cacheKey,
      timestamp: new Date().toISOString()
    });

    // Normalize response format to match OpenAI format
    let normalizedResponse = response.data;
    
    // Check if this is the /api/chat format and convert to OpenAI format
    if (response.data.message && !response.data.choices) {
      normalizedResponse = {
        choices: [{
          message: {
            role: response.data.message.role,
            content: response.data.message.content
          }
        }],
        model: response.data.model,
        created: response.data.created_at ? new Date(response.data.created_at).getTime() / 1000 : Date.now() / 1000
      };
    }

    // Cache the normalized response
    llmCache.set(cacheKey, {
      response: normalizedResponse,
      timestamp: Date.now(),
      ticker: ticker
    });
    
    // Save cache to file periodically (every 10 entries)
    if (llmCache.size % 10 === 0) {
      saveCacheToFile();
    }

    res.json(normalizedResponse);
  } catch (err) {
    // Log the error
    logToFile('ERROR', {
      error: err.message,
      response: err.response?.data,
      status: err.response?.status,
      ticker: ticker,
      cacheKey: cacheKey,
      timestamp: new Date().toISOString()
    });
    
    console.error(err);
    res.status(500).json({ error: 'Failed to analyze data.' });
  }
});

// Save cache on graceful shutdown
process.on('SIGINT', () => {
  console.log('\nSaving cache before exit...');
  saveCacheToFile();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nSaving cache before exit...');
  saveCacheToFile();
  process.exit(0);
});

if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`)
  );
}

module.exports = app;
