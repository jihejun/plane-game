// ==================== 后端服务器 ====================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.static('.')); // 静态文件服务
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 房间管理
const rooms = {};

// 生成房间ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 生成二维码
async function generateRoomQR(roomId) {
  const url = `http://localhost:3000?room=${roomId}`;
  return await QRCode.toDataURL(url);
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 创建房间
  socket.on('create-room', async (data) => {
    const roomId = generateRoomId();
    const playerName = data.playerName || '玩家';
    
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      players: [
        { id: socket.id, name: playerName, playerNum: 1, ready: false }
      ],
      gameState: 'waiting',
      createdAt: Date.now()
    };
    
    socket.join(roomId);
    
    // 生成二维码
    const qrCode = await generateRoomQR(roomId);
    
    socket.emit('room-created', {
      roomId,
      playerNum: 1,
      qrCode,
      roomUrl: `http://localhost:3000?room=${roomId}`,
      players: rooms[roomId].players
    });
    
    console.log(`房间创建: ${roomId}`);
  });

  // 加入房间
  socket.on('join-room', async (data) => {
    const { roomId, playerName } = data;
    const room = rooms[roomId];
    
    if (!room) {
      socket.emit('error', '房间不存在');
      return;
    }
    
    if (room.players.length >= 3) {
      socket.emit('error', '房间已满');
      return;
    }
    
    const playerNum = room.players.length + 1;
    const newPlayer = {
      id: socket.id,
      name: playerName || `玩家${playerNum}`,
      playerNum,
      ready: false
    };
    
    room.players.push(newPlayer);
    socket.join(roomId);
    
    // 通知所有玩家
    io.to(roomId).emit('player-joined', {
      player: newPlayer,
      players: room.players
    });
    
    socket.emit('room-joined', {
      roomId,
      playerNum,
      players: room.players
    });
    
    console.log(`${newPlayer.name} 加入房间 ${roomId}`);
  });

  // 玩家准备
  socket.on('player-ready', (data) => {
    const roomId = data.roomId;
    const room = rooms[roomId];
    
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.ready = true;
        
        io.to(roomId).emit('player-ready-changed', {
          playerId: socket.id,
          playerNum: player.playerNum,
          ready: true,
          players: room.players
        });
        
        // 检查是否全部准备
        const allReady = room.players.length === 3 && 
                         room.players.every(p => p.ready);
        
        if (allReady) {
          room.gameState = 'playing';
          room.currentPlayer = 1;
          
          io.to(roomId).emit('game-started', {
            currentPlayer: 1,
            players: room.players
          });
        }
      }
    }
  });

  // 游戏操作
  socket.on('attack', (data) => {
    const { roomId, targetPlayer, row, col } = data;
    const room = rooms[roomId];
    
    if (room && room.gameState === 'playing') {
      // 模拟攻击结果
      const isHit = Math.random() > 0.5; // 50%命中率
      
      io.to(roomId).emit('attack-result', {
        attacker: data.playerNum,
        target: targetPlayer,
        row,
        col,
        isHit,
        timestamp: Date.now()
      });
      
      // 切换玩家
      room.currentPlayer = room.currentPlayer === 1 ? 2 : 
                          room.currentPlayer === 2 ? 3 : 1;
      
      io.to(roomId).emit('turn-changed', {
        currentPlayer: room.currentPlayer
      });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id);
    
    // 从所有房间移除
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const index = room.players.findIndex(p => p.id === socket.id);
      
      if (index !== -1) {
        room.players.splice(index, 1);
        
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('player-left', {
            playerId: socket.id
          });
        }
      }
    });
  });
});

// 微信分享接口
app.get('/wechat/share', (req, res) => {
  const { roomId } = req.query;
  const room = rooms[roomId];
  
  if (room) {
    res.json({
      success: true,
      roomId,
      playerCount: room.players.length,
      maxPlayers: 3,
      joinUrl: `http://localhost:3000?room=${roomId}`
    });
  } else {
    res.json({ success: false, message: '房间不存在' });
  }
});

// 启动服务器
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 服务器启动成功！`);
  console.log(`📱 本地访问: http://localhost:${PORT}`);
  console.log(`📱 手机访问（同一WiFi）: http://${getLocalIP()}:${PORT}`);
});

// 获取本地IP
function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}