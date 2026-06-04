import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import EnergyWebSocketServer from './services/WebSocketServer';
import dbMaintenance from './services/DatabaseMaintenanceService';

dotenv.config();

const app = express();
const server = createServer(app);

const PORT = process.env.API_PORT || 3001;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.json({
    name: '智能楼宇能源管理系统 API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      meterPoints: '/api/meter-points',
      alerts: '/api/alerts',
      pricing: '/api/pricing',
      acControl: '/api/ac-control',
    },
    websocket: '/ws',
  });
});

const wss = new EnergyWebSocketServer();

server.listen(PORT, async () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`🔌 WebSocket Server running on ws://localhost:${PORT}/ws`);
  
  await wss.init(server);
  await dbMaintenance.init();
  
  console.log(`📊 Energy Management System started successfully`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  dbMaintenance.stop();
  wss.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
