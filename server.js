require('dotenv').config();
const express = require('express');
const axios = require('axios');
const dayjs = require('dayjs');
const path = require('path');
const Database = require('./database');
const APILogger = require('./logger');
const app = express();
const PORT = 3001;
const LLM_API_URL = process.env.LLM_API_URL || 'http://192.168.1.122:11434/api/chat';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen3:8b';

// Initialize database and logger
const db = new Database();
const apiLogger = new APILogger('openai-api.log');
let dbInitialized = false;

// Middleware to parse JSON bodies
app.use(express.json());

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/chartdata', async (req, res) => {
  const ticker = req.query.ticker || 'AAPL';
  const period = req.query.period || '1Y';

  try {
    // Check cache first (if database is initialized)
    if (dbInitialized) {
      const cachedData = await db.getCachedStockData(ticker, period);
      if (cachedData) {
        console.log(`Cache hit for ${ticker} ${period}`);
        return res.json(cachedData);
      }
    }

    console.log(`Cache miss for ${ticker} ${period}, fetching from API`);

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

    const calculateRSI = (arr, window = 14) => {
      const result = [];
      let avgGain = 0;
      let avgLoss = 0;
      for (let i = 0; i < arr.length; i++) {
        if (i === 0) {
          result.push({ ...arr[i], rsi14: null });
          continue;
        }
        const change = arr[i].close - arr[i - 1].close;
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        if (i <= window) {
          avgGain += gain;
          avgLoss += loss;
          if (i === window) {
            avgGain /= window;
            avgLoss /= window;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            result.push({ ...arr[i], rsi14: 100 - 100 / (1 + rs) });
          } else {
            result.push({ ...arr[i], rsi14: null });
          }
        } else {
          avgGain = (avgGain * (window - 1) + gain) / window;
          avgLoss = (avgLoss * (window - 1) + loss) / window;
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          result.push({ ...arr[i], rsi14: 100 - 100 / (1 + rs) });
        }
      }
      return result;
    };

    const rsi14 = calculateRSI(data, 14);

    // Merge indicator values so all are based on the full 5y history
    const merged = data.map((d, idx) => ({
      ...d,
      ma50: ma50[idx].ma50,
      ma200: ma200[idx].ma200,
      rsi14: rsi14[idx].rsi14
    }));

    // Filter to requested period while keeping indicator values from 5y data
    const filtered = merged.filter(d => dayjs(d.date).isAfter(filterStart) || d.date === filterStart);

    // Cache the result if database is initialized
    if (dbInitialized) {
      await db.cacheStockData(ticker, period, filtered);
    }

    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch or process data.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { ticker, goldenCrossDate, increasePercent, sector, data, bypassCache } = req.body;
  
  try {
    // Check cache first (if database is initialized and not bypassing cache)
    if (dbInitialized && !bypassCache) {
      const cachedResponse = await db.getCachedLLMResponse(ticker, goldenCrossDate, increasePercent, sector, data);
      if (cachedResponse) {
        console.log(`LLM cache hit for ${ticker}`);
        apiLogger.logCacheEvent('HIT', {
          ticker,
          goldenCrossDate,
          increasePercent,
          sector,
          dataPoints: data.length
        });
        return res.json(cachedResponse);
      }
    }

    if (bypassCache) {
      console.log(`LLM cache bypassed for ${ticker}, requesting from LLM`);
      apiLogger.logCacheEvent('BYPASS', {
        ticker,
        goldenCrossDate,
        increasePercent,
        sector,
        dataPoints: data.length
      });
    } else {
      console.log(`LLM cache miss for ${ticker}, requesting from LLM`);
      if (dbInitialized) {
        apiLogger.logCacheEvent('MISS', {
          ticker,
          goldenCrossDate,
          increasePercent,
          sector,
          dataPoints: data.length
        });
      }
    }
    
    // Extract RSI values for analysis
    const currentRSI = data[data.length - 1]?.rsi14;
    const rsiAtCross = data.find(d => d.date === goldenCrossDate)?.rsi14;
    
    const prompt = `Analyze the probability that the stock increases ${increasePercent}% in 30, 60 and 90 days. Group results by sector tag ${sector} and discuss false positives. 

Technical Analysis Context:
- Current RSI (14-day): ${currentRSI ? currentRSI.toFixed(2) : 'N/A'}
- RSI at Golden Cross: ${rsiAtCross ? rsiAtCross.toFixed(2) : 'N/A'}
- RSI Interpretation: Values above 70 suggest overbought conditions, below 30 suggest oversold conditions
- Given a golden cross occurred on ${goldenCrossDate} for ${ticker}
- Include RSI analysis in your assessment of momentum and potential price movements. Use the following complete data including RSI values: ${JSON.stringify(data)}
- Always answer with a **Recomendation** Buy,hold och sell and a full anaylze of the stock`;

    const requestPayload = {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: 'You are a financial analysis assistant with expertise in technical analysis indicators including RSI, moving averages, and golden cross patterns.' },
        { role: 'user', content: prompt }
      ],
      think: false,    
      stream: false
    };

    // Log the request
    apiLogger.logRequest({
      url: LLM_API_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        ...requestPayload,
        // Truncate data for logging to avoid huge logs
        metadata: {
          ticker,
          goldenCrossDate,
          increasePercent,
          sector,
          dataPoints: data.length,
          currentRSI: currentRSI ? currentRSI.toFixed(2) : 'N/A',
          rsiAtCross: rsiAtCross ? rsiAtCross.toFixed(2) : 'N/A'
        }
      }
    });

    const response = await axios.post(LLM_API_URL, requestPayload);

    // Log the response
    apiLogger.logResponse({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data
    });

    // Transform Ollama response to OpenAI-compatible format for frontend
    const transformedResponse = {
      choices: [{
        message: {
          content: response.data.message.content
        }
      }]
    };

    // Cache the transformed response if database is initialized
    if (dbInitialized) {
      await db.cacheLLMResponse(ticker, goldenCrossDate, increasePercent, sector, data, transformedResponse);
    }

    res.json(transformedResponse);
  } catch (err) {
    console.error(err);
    
    // Log the error
    apiLogger.logError(err, `LLM analysis for ${ticker}`);
    
    res.status(500).json({ error: 'Failed to analyze data.' });
  }
});

// API endpoint to get log statistics
app.get('/api/logs/stats', (req, res) => {
  try {
    const stats = apiLogger.getLogStats();
    res.json(stats);
  } catch (err) {
    console.error('Failed to get log stats:', err);
    res.status(500).json({ error: 'Failed to get log statistics' });
  }
});

if (require.main === module) {
  // Initialize database and start server
  db.init()
    .then(() => {
      dbInitialized = true;
      console.log('Database initialized successfully');
      
      // Clean expired cache entries on startup
      return db.cleanExpiredCache();
    })
    .then(() => {
      console.log('Expired cache entries cleaned');
      
      // Start the server
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log('Cache system enabled - stock data cached for 1 hour, LLM responses for 24 hours');
        console.log('LLM API logging enabled - logs saved to openai-api.log');
        console.log('Log stats available at: /api/logs/stats');
      });
      
      // Clean expired cache and rotate logs every hour
      setInterval(() => {
        if (dbInitialized) {
          db.cleanExpiredCache()
            .then(() => console.log('Periodic cache cleanup completed'))
            .catch(err => console.error('Cache cleanup failed:', err));
        }
        
        // Rotate log file if needed
        apiLogger.rotateLogIfNeeded();
      }, 60 * 60 * 1000); // 1 hour
    })
    .catch(err => {
      console.error('Database initialization failed:', err);
      console.log('Starting server without cache functionality');
      
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log('Cache system disabled due to database error');
      });
    });
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down server...');
    if (db) {
      db.close();
    }
    process.exit(0);
  });
}

module.exports = app;
