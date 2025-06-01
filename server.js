require('dotenv').config();
const express = require('express');
const axios = require('axios');
const dayjs = require('dayjs');
const path = require('path');
const app = express();
const PORT = 3001;
const LLM_API_URL = process.env.LLM_API_URL || 'http://192.168.1.122:11434/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen3:8b';

// Middleware to parse JSON bodies
app.use(express.json());

app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/chartdata', async (req, res) => {
  const ticker = req.query.ticker || 'AAPL';
  const period = req.query.period || '1Y';
  
  // Calculate start date based on period
  const now = dayjs();
  let startDate;
  
  switch(period) {
    case '6M':
      startDate = now.subtract(6, 'month').format('YYYY-MM-DD');
      break;
    case '1Y':
      startDate = now.subtract(1, 'year').format('YYYY-MM-DD');
      break;
    case '2Y':
      startDate = now.subtract(2, 'year').format('YYYY-MM-DD');
      break;
    case '5Y':
      startDate = now.subtract(5, 'year').format('YYYY-MM-DD');
      break;
    default:
      startDate = now.subtract(1, 'year').format('YYYY-MM-DD');
  }

  try {
    const response = await axios.get(`https://api.tiingo.com/tiingo/daily/${ticker}/prices`, {
      params: {
        startDate,
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
    const ma200 = calculateMA(ma50, 200);

    res.json(ma200);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch or process data.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { ticker, goldenCrossDate, increasePercent, sector, data } = req.body;
  const prompt = `Given a golden cross occurred on ${goldenCrossDate} for ${ticker}, analyze the probability that the stock increases ${increasePercent}% in 30, 60 and 90 days. Group results by sector tag ${sector} and discuss false positives. Use the following data: ${JSON.stringify(data)}`;

  try {
    const response = await axios.post(LLM_API_URL, {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: 'You are a financial analysis assistant.' },
        { role: 'user', content: prompt }
      ]
    });
    res.json(response.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to analyze data.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`)
  );
}

module.exports = app;
