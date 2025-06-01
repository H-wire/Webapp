require('dotenv').config();
const express = require('express');
const axios = require('axios');
const dayjs = require('dayjs');
const path = require('path');
const app = express();
const PORT = 3001;

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

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
