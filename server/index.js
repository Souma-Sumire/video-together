const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const axios = require("axios");
const port = 3000;
const clients = new Set();
const videoFolderPath = path.join(__dirname, "videos");
const videoFiles = [];
const upstreamData = {
  stauts: "pause",
  fileName: "",
  recordTime: 0,
  timestamp: 0,
};

const updateVideoFiles = () => {
  videoFiles.length = 0;
  videoFiles.push(...fs.readdirSync(videoFolderPath));
};
updateVideoFiles();

app.use("/videos", express.static(path.join(__dirname, "videos")));

wss.on("connection", (ws) => {
  clients.add(ws);

  // 中途加入房间，通知新加入成员
  if (upstreamData.fileName !== "") {
    ws.send(JSON.stringify({ type: "select", fileName: upstreamData.fileName }));
    ws.send(
      JSON.stringify({
        type: upstreamData.stauts === "play" ? "play" : "seek",
        currentTime: +upstreamData.recordTime + +(Math.round(Date.now() - upstreamData.timestamp) / 1000),
      }),
    );
  }
  // 当有新客户端连接时，通知其他客户端
  broadcastMessage({ type: "userCount", count: clients.size });

  // 将视频文件列表广播给当前连接的客户端
  ws.send(JSON.stringify({ type: "videoList", videos: videoFiles }));

  ws.on("message", (message) => {
    const decodedMessage = JSON.parse(message.toString("utf-8"));
    if (decodedMessage.type === "updateVideoFiles") {
      updateVideoFiles();
      ws.send(JSON.stringify({ type: "videoList", videos: videoFiles }));
    } else {
      if (decodedMessage.fileName) {
        upstreamData.fileName = decodedMessage.fileName;
      }
      if (decodedMessage.currentTime) {
        upstreamData.recordTime = decodedMessage.currentTime;
        upstreamData.timestamp = Date.now();
      }
      if (decodedMessage.type === "play") upstreamData.stauts = "play";
      else if (decodedMessage.type === "pause") upstreamData.stauts = "pause";
      broadcastMessage(decodedMessage);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    // 当有客户端断开连接时，通知其他客户端
    broadcastMessage({ type: "userCount", count: clients.size });
    if (clients.size === 0) {
      upstreamData.fileName = "";
      upstreamData.recordTime = 0;
    }
  });
});

wss.on("error", (error) => {
  console.error("WebSocket server error:", error);
});

function broadcastMessage(message) {
  const jsonMessage = JSON.stringify(message);
  clients.forEach((client) => {
    client.send(jsonMessage);
  });
}

server.listen(port, "::", "0.0.0.0", () => {
  let ipv4;
  axios
    .get("https://api.ipify.org?format=json")
    .then((response) => {
      const publicIP = response.data.ip;
      ipv4 = publicIP;
      console.log(`IPv4 is running on ${publicIP}:${port}`);
    })
    .catch((error) => {
      console.error("Error fetching public IP:", error);
    });
  axios
    .get("https://api64.ipify.org?format=json")
    .then((response) => {
      const publicIP = response.data.ip;
      if (publicIP !== ipv4) {
        console.log(`IPv6 is running on [${publicIP}]:${port}`);
      }
    })
    .catch((error) => {
      console.error("Error fetching public IP:", error);
    });
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
