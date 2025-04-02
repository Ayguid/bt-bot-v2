const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

class VisualizationServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server);
    this.setupMiddleware();
  }

  setupMiddleware() {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../public')));
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'healthy' });
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`📊 Visualization server running on http://localhost:${this.port}`);
        resolve();
      });
      
      this.io.on('connection', (socket) => {
        console.log('📊 New client connected');
        socket.on('disconnect', () => {
          console.log('📊 Client disconnected');
        });
      });
    });
  }

  emitData(data) {
    if (this.io) {
      this.io.emit('data-update', data);
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('📊 Visualization server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = VisualizationServer;