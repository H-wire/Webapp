# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js web application that provides stock chart visualization with technical analysis. The app serves a comprehensive trading interface displaying stock price data with 50-day and 200-day moving averages, RSI indicators, and golden cross detection, integrated with LLM-based analysis capabilities.

## Architecture

- **Backend**: Express.js server (`server.js`) with two main API endpoints:
  - `/api/chartdata` - Fetches and processes stock data with technical indicators
  - `/api/analyze` - Sends technical analysis data to LLM for probabilistic assessment
- **Database Layer**: SQLite caching system (`database.js`) for stock data and LLM responses
- **Frontend**: Single-page application (`public/index.html`) using Chart.js with dual y-axis support
- **Data Source**: Tiingo API for historical stock price data
- **LLM Integration**: Configurable LLM endpoint (defaults to local Ollama server) for analysis
- **Key Features**: MA calculations, RSI (14-day), golden cross detection, trend analysis, intelligent caching

## Development Commands

- `npm install` - Install dependencies  
- `npm start` - Start the development server on port 3001 with caching enabled
- `npm test` - Run Node.js built-in test runner (basic test suite available)

## Environment Setup

- Create `.env` file with required variables:
  - `TIINGO_API_KEY` - Required for stock data access
  - `LLM_API_URL` - Optional, defaults to `http://192.168.1.122:11434/api/chat` (Ollama format)
  - `LLM_MODEL` - Optional, defaults to `qwen3:8b`
- Server runs on `http://localhost:3001` (note: port 3001, not 3000)

## Technical Analysis Implementation

- **Data Processing**: Always fetches 5 years of data for consistent MA/RSI calculations, then filters to requested period
- **Moving Averages**: Server-side calculation using full 5-year history before period filtering
- **RSI Calculation**: 14-day RSI with proper smoothing using exponential moving averages
- **Golden Cross Detection**: Identifies when 50-day MA crosses above 200-day MA within last 5 trading days
- **LLM Integration**: Sends complete dataset including RSI values and extracted key metrics to analysis endpoint

## Caching System

- **SQLite Database**: `cache.db` file stores cached data locally
- **Stock Data Cache**: Chart data cached for 1 hour to reduce Tiingo API calls
- **LLM Response Cache**: Analysis responses cached for 24 hours to avoid expensive LLM calls
- **Automatic Cleanup**: Expired cache entries cleaned hourly and on server startup
- **Cache Keys**: LLM cache uses MD5 hash of request parameters for efficient lookups
- **Graceful Degradation**: Server runs without caching if database initialization fails

## Frontend Features

- **Responsive Design**: Dark theme with mobile-optimized layout
- **Preset Stocks**: Includes Swedish stocks (VOLV-B.ST, ERIC-B.ST, ASSA-B.ST, SEB-A.ST) and US stocks (AAPL, MSFT)
- **Time Periods**: 6M, 1Y, 2Y, 5Y view options with consistent technical indicator values
- **Dual Chart Display**: Price/MA data on primary y-axis, RSI on secondary y-axis (0-100 scale)
- **Real-time Analysis**: Automatic LLM analysis calls when loading new stock data
- **LLM Analysis Display**: Dedicated panel showing formatted LLM responses with loading states