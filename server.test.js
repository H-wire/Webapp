const test = require('node:test');
const assert = require('node:assert');
const fetch = global.fetch;
const axios = require('axios');
const app = require('./server');

test('POST /api/analyze returns analysis', async () => {
  const originalPost = axios.post;
  axios.post = async () => ({ data: { result: 'analysis' } });

  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'AAPL',
        goldenCrossDate: '2024-05-01',
        increasePercent: 10,
        sector: 'Tech',
        data: []
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(data, { result: 'analysis' });
  } finally {
    axios.post = originalPost;
    server.close();
  }
});

test('POST /api/analyze handles errors', async () => {
  const originalPost = axios.post;
  axios.post = async () => { throw new Error('fail'); };

  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://localhost:${port}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    assert.strictEqual(res.status, 500);
    assert.ok(data.error);
  } finally {
    axios.post = originalPost;
    server.close();
  }
});
