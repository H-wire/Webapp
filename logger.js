const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

class APILogger {
  constructor(logFilePath = 'openai-api.log') {
    this.logFile = path.join(__dirname, logFilePath);
    this.ensureLogFile();
  }

  ensureLogFile() {
    try {
      if (!fs.existsSync(this.logFile)) {
        fs.writeFileSync(this.logFile, '');
        console.log(`Log file created: ${this.logFile}`);
      }
    } catch (err) {
      console.error('Failed to create log file:', err);
    }
  }

  formatLogEntry(type, data) {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss.SSS');
    const separator = '='.repeat(80);
    
    let logEntry = `\n${separator}\n`;
    logEntry += `[${timestamp}] ${type.toUpperCase()}\n`;
    logEntry += `${separator}\n`;
    
    if (typeof data === 'object') {
      logEntry += JSON.stringify(data, null, 2);
    } else {
      logEntry += data;
    }
    
    logEntry += `\n${separator}\n`;
    
    return logEntry;
  }

  logRequest(requestData) {
    try {
      const logEntry = this.formatLogEntry('LLM REQUEST', {
        url: requestData.url,
        method: requestData.method,
        headers: this.sanitizeHeaders(requestData.headers),
        body: requestData.body,
        timestamp: dayjs().toISOString()
      });
      
      fs.appendFileSync(this.logFile, logEntry);
      console.log('LLM request logged');
    } catch (err) {
      console.error('Failed to log request:', err);
    }
  }

  logResponse(responseData, requestId = null) {
    try {
      const logEntry = this.formatLogEntry('LLM RESPONSE', {
        requestId,
        status: responseData.status,
        statusText: responseData.statusText,
        headers: this.sanitizeHeaders(responseData.headers),
        data: responseData.data,
        timestamp: dayjs().toISOString()
      });
      
      fs.appendFileSync(this.logFile, logEntry);
      console.log('LLM response logged');
    } catch (err) {
      console.error('Failed to log response:', err);
    }
  }

  logError(error, context = '') {
    try {
      const logEntry = this.formatLogEntry('LLM ERROR', {
        context,
        message: error.message,
        stack: error.stack,
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : null,
        timestamp: dayjs().toISOString()
      });
      
      fs.appendFileSync(this.logFile, logEntry);
      console.log('LLM error logged');
    } catch (err) {
      console.error('Failed to log error:', err);
    }
  }

  logCacheEvent(event, data) {
    try {
      const logEntry = this.formatLogEntry(`CACHE ${event}`, {
        ...data,
        timestamp: dayjs().toISOString()
      });
      
      fs.appendFileSync(this.logFile, logEntry);
    } catch (err) {
      console.error('Failed to log cache event:', err);
    }
  }

  sanitizeHeaders(headers) {
    if (!headers) return {};
    
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    const sensitiveHeaders = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  // Rotate log file if it gets too large (>10MB)
  rotateLogIfNeeded() {
    try {
      const stats = fs.statSync(this.logFile);
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (stats.size > maxSize) {
        const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');
        const backupFile = this.logFile.replace('.log', `_${timestamp}.log`);
        
        fs.renameSync(this.logFile, backupFile);
        fs.writeFileSync(this.logFile, '');
        
        console.log(`Log file rotated: ${backupFile}`);
        
        // Keep only last 5 backup files
        this.cleanOldLogs();
      }
    } catch (err) {
      console.error('Failed to rotate log file:', err);
    }
  }

  cleanOldLogs() {
    try {
      const dir = path.dirname(this.logFile);
      const baseName = path.basename(this.logFile, '.log');
      
      const files = fs.readdirSync(dir)
        .filter(file => file.startsWith(baseName) && file.includes('_') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(dir, file),
          time: fs.statSync(path.join(dir, file)).mtime
        }))
        .sort((a, b) => b.time - a.time);
      
      // Keep only the 5 most recent backup files
      if (files.length > 5) {
        files.slice(5).forEach(file => {
          fs.unlinkSync(file.path);
          console.log(`Deleted old log file: ${file.name}`);
        });
      }
    } catch (err) {
      console.error('Failed to clean old logs:', err);
    }
  }

  // Get log statistics
  getLogStats() {
    try {
      if (!fs.existsSync(this.logFile)) {
        return { exists: false };
      }

      const stats = fs.statSync(this.logFile);
      const content = fs.readFileSync(this.logFile, 'utf8');
      
      const requestCount = (content.match(/LLM REQUEST/g) || []).length;
      const responseCount = (content.match(/LLM RESPONSE/g) || []).length;
      const errorCount = (content.match(/LLM ERROR/g) || []).length;
      const cacheHits = (content.match(/CACHE HIT/g) || []).length;
      const cacheMisses = (content.match(/CACHE MISS/g) || []).length;

      return {
        exists: true,
        size: stats.size,
        sizeHuman: this.formatBytes(stats.size),
        lastModified: stats.mtime,
        requestCount,
        responseCount,
        errorCount,
        cacheHits,
        cacheMisses,
        cacheHitRate: cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1) + '%' : '0%'
      };
    } catch (err) {
      console.error('Failed to get log stats:', err);
      return { exists: false, error: err.message };
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = APILogger;