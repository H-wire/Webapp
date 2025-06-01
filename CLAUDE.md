# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js web application that provides stock chart visualization with moving averages. The app serves a trading interface that displays stock price data, calculates 50-day and 200-day moving averages, and provides technical analysis including golden cross detection.

## Architecture

- **Backend**: Express.js server (`server.js`) that serves static files and provides `/api/chartdata` endpoint
- **Frontend**: Single-page application (`public/index.html`) with Chart.js for visualization
- **Data Source**: Tiingo API for real-time stock price data
- **Key Features**: Moving average calculations, golden cross analysis, technical indicators

## Development Commands

- `npm install` - Install dependencies
- `npm start` - Start the development server on port 3001
- No test framework is currently configured

## Environment Setup

- Create `.env` file with `TIINGO_API_KEY` variable for API access
- Server runs on `http://localhost:3001` (note: not 3000)

## Important Notes

- The server currently references `index2.html` in the route handler but serves `index.html` from static files
- Stock data fetching starts from 2022-01-01 and uses daily frequency
- Moving average calculations are performed server-side in the `/api/chartdata` endpoint
- Frontend includes preset Swedish stocks (VOLV-B.ST, ERIC-B.ST, etc.) alongside US stocks