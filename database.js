const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dayjs = require('dayjs');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, 'cache.db');
  }

  init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Create tables if they don't exist
        this.createTables()
          .then(resolve)
          .catch(reject);
      });
    });
  }

  createTables() {
    return new Promise((resolve, reject) => {
      const createStockDataTable = `
        CREATE TABLE IF NOT EXISTS stock_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL,
          period TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          UNIQUE(ticker, period)
        )
      `;

      const createLLMCacheTable = `
        CREATE TABLE IF NOT EXISTS llm_cache (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_hash TEXT UNIQUE NOT NULL,
          ticker TEXT NOT NULL,
          golden_cross_date TEXT,
          increase_percent REAL,
          sector TEXT,
          response_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME
        )
      `;

      this.db.run(createStockDataTable, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run(createLLMCacheTable, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }

  // Cache stock data for 1 hour
  cacheStockData(ticker, period, data) {
    return new Promise((resolve, reject) => {
      const expiresAt = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss');
      const query = `
        INSERT OR REPLACE INTO stock_data (ticker, period, data_json, expires_at)
        VALUES (?, ?, ?, ?)
      `;
      
      this.db.run(query, [ticker, period, JSON.stringify(data), expiresAt], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Get cached stock data if not expired
  getCachedStockData(ticker, period) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT data_json FROM stock_data 
        WHERE ticker = ? AND period = ? AND expires_at > datetime('now')
      `;
      
      this.db.get(query, [ticker, period], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve(JSON.parse(row.data_json));
        } else {
          resolve(null);
        }
      });
    });
  }

  // Create a hash for LLM request to use as cache key
  createRequestHash(ticker, goldenCrossDate, increasePercent, sector, dataLength) {
    const crypto = require('crypto');
    const content = `${ticker}-${goldenCrossDate}-${increasePercent}-${sector}-${dataLength}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  // Cache LLM response for 24 hours
  cacheLLMResponse(ticker, goldenCrossDate, increasePercent, sector, data, response) {
    return new Promise((resolve, reject) => {
      const requestHash = this.createRequestHash(ticker, goldenCrossDate, increasePercent, sector, data.length);
      const expiresAt = dayjs().add(24, 'hours').format('YYYY-MM-DD HH:mm:ss');
      
      const query = `
        INSERT OR REPLACE INTO llm_cache 
        (request_hash, ticker, golden_cross_date, increase_percent, sector, response_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db.run(query, [
        requestHash, ticker, goldenCrossDate, increasePercent, sector, 
        JSON.stringify(response), expiresAt
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Get cached LLM response if not expired
  getCachedLLMResponse(ticker, goldenCrossDate, increasePercent, sector, data) {
    return new Promise((resolve, reject) => {
      const requestHash = this.createRequestHash(ticker, goldenCrossDate, increasePercent, sector, data.length);
      
      const query = `
        SELECT response_json FROM llm_cache 
        WHERE request_hash = ? AND expires_at > datetime('now')
      `;
      
      this.db.get(query, [requestHash], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve(JSON.parse(row.response_json));
        } else {
          resolve(null);
        }
      });
    });
  }

  // Clean expired cache entries
  cleanExpiredCache() {
    return new Promise((resolve, reject) => {
      const deleteStockData = `DELETE FROM stock_data WHERE expires_at <= datetime('now')`;
      const deleteLLMCache = `DELETE FROM llm_cache WHERE expires_at <= datetime('now')`;
      
      this.db.run(deleteStockData, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run(deleteLLMCache, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = Database;