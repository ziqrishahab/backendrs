const { Server } = require('socket.io');
const { verifyAccessToken } = require('./jwt');
const ADMIN_ROOM = 'admin-dashboard';

let io = null;

const extractToken = (socket, payload) => {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && payload.token) return payload.token;
  const authHeader = socket.handshake?.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return socket.handshake?.auth?.token;
};

const initSocket = (httpServer) => {
  io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  io.on('connection', (socket) => {
    socket.on('admin_join', (payload) => {
      const token = extractToken(socket, payload);
      if (!token) return socket.emit('admin_error', { message: 'Token diperlukan' });
      try {
        const decoded = verifyAccessToken(token);
        if (decoded.type !== 'admin') return socket.emit('admin_error', { message: 'Akses ditolak. Hanya untuk admin.' });
        socket.join(ADMIN_ROOM);
      } catch {
        socket.emit('admin_error', { message: 'Token tidak valid atau kedaluwarsa' });
      }
    });
    socket.on('admin_leave', () => socket.leave(ADMIN_ROOM));
  });
  return io;
};

const broadcastToAdmins = (event, data) => {
  io?.to(ADMIN_ROOM).emit(event, data);
};

const getConnectedAdmins = () => io?.sockets?.adapter?.rooms?.get(ADMIN_ROOM)?.size || 0;

module.exports = { initSocket, broadcastToAdmins, getConnectedAdmins };
