# Webapp

This simple Node.js webapp serves `index.html` and provides API endpoints for chart data and LLM-based analysis. The server depends on the following packages:

- `dotenv`
- `express`
- `axios`
- `dayjs`

## Setup

1. Make sure you have Node.js installed.
2. Run `npm install` to install dependencies.
3. Create a `.env` file with your `TIINGO_API_KEY` variable. Optionally add `LLM_API_URL` and `LLM_MODEL` to configure the analysis endpoint.
4. Start the server with `npm start` and open `http://localhost:3000` in your browser.
5. Run `npm test` to execute the built-in tests.

### Chart Data Endpoint

`GET /api/chartdata` always retrieves five years of historical prices. Moving
averages for 50 and 200 days are calculated from this full history so the lines
start immediately when viewing shorter ranges. The response is then filtered to
the requested period (6M, 1Y, 2Y or 5Y).

### Analysis Endpoint

`POST /api/analyze` sends chart data and parameters to a local OpenAI-compatible API (defaults to `http://192.168.1.122:11434/v1/chat/completions` using model `qwen3:8b`) for probabilistic analysis of golden cross events. The request body should include `ticker`, `goldenCrossDate`, `increasePercent`, `sector` and `data`.

