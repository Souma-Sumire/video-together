<template>
  <div>
    <form v-show="socketStatus !== SocketStatus.success">
      {{ client }}
      主机：<input type="text" v-model="server" />
      <input type="button" value="连接" @click="handleConnect" />
      <p>{{ socketStatus }}</p>
    </form>
    <div v-show="socketStatus === SocketStatus.success && fileName">
      <p>
        正在播放
        <strong>{{ fileName }}</strong>
        <br />
        <span v-show="socketStatus === SocketStatus.success">房间人数: {{ userCount }}</span>
      </p>
      <video ref="videoPlayer" controls @play="startPlayback" @pause="pausePlayback" @seeked="seekPlayback" @ratechange="rateChangeback"></video>
    </div>
    <div>
      <ul>
        <li v-for="item in videos" @click="handleListClick">
          <a :id="item"> {{ item }}</a>
        </li>
      </ul>
      <button v-if="videos.length" @click="updateVideoFiles">刷新文件列表</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Ref, onUnmounted, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { ElNotification } from "element-plus";
import { v4 as uuidv4 } from "uuid";

const userCount = ref(0);
const videoPlayer: Ref<HTMLVideoElement | null> = ref(null);
const server = useStorage("video-together-server", "127.0.0.1:3000", localStorage);
const client = "";
let socket: WebSocket;
let socketStatus = ref<SocketStatus>();
const UUID = uuidv4();
const changeMessage = {
  playAndSeek: 0,
  pause: 0,
  seek: 0,
  rate: 0,
};
const videos: Ref<string[]> = ref([]);
const fileName = ref("");
enum SocketStatus {
  connecting = "正在连接",
  success = "连接成功",
  failed = "连接失败",
}
let heartbeatInterval: number | undefined;

const openMessage = (message: string, duration = 1000) => {
  return ElNotification({ message, duration, showClose: false }).close;
};

const startHeartbeat = () => {
  heartbeatInterval && clearInterval(heartbeatInterval);
  // 设置一个定时器，每隔一定时间发送心跳消息
  heartbeatInterval = setInterval(sendHeartbeat, 5000); // 每5秒发送一次心跳
};

const sendHeartbeat = () => {
  socket && socket.send(JSON.stringify({ type: "heartbeat", source: UUID }));
};

// let closeUserCount: Function;

const handleConnect = () => {
  server.value = server.value.trim();
  socket = new WebSocket(`ws://${server.value}`);
  socketStatus.value = SocketStatus.connecting;
  socket.addEventListener("open", () => {
    socketStatus.value = SocketStatus.success;
    startHeartbeat(); // 启动心跳
  });
  socket.addEventListener("close", () => {
    ElNotification({
      title: "错误",
      message: "连接已断开",
      type: "error",
      duration: 0,
    });
    heartbeatInterval && clearInterval(heartbeatInterval);
    socketStatus.value = SocketStatus.failed;
  });
  socket.addEventListener("error", () => {
    socketStatus.value = SocketStatus.failed;
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "userCount") {
      userCount.value = message.count;
      // closeUserCount && closeUserCount();
      // closeUserCount = openMessage("当前观众:" + message.count, 3000);
    }
    if (message.source !== UUID && videoPlayer.value) {
      if (message.type === "play") {
        changeMessage.playAndSeek = Date.now();
        if (videoPlayer.value.paused) {
          videoPlayer.value.currentTime = message.currentTime;
          videoPlayer.value.play();
          openMessage("播放", 3000);
          console.log("接受play");
        }
      } else if (message.type === "seek") {
        changeMessage.playAndSeek = Date.now();
        if (Math.abs(videoPlayer.value.currentTime - message.currentTime) > 1) {
          videoPlayer.value.currentTime = message.currentTime;
          openMessage("同步进度", 3000);
          console.log("接受seek");
        }
      } else if (message.type === "pause") {
        changeMessage.pause = Date.now();
        if (!videoPlayer.value.paused) {
          videoPlayer.value.pause();
          openMessage("暂停", 3000);
          console.log("接受pause");
        }
      } else if (message.type === "rate") {
        changeMessage.rate = Date.now();
        if (!Number.isNaN(message.playbackRate) && videoPlayer.value.playbackRate !== message.playbackRate) {
          videoPlayer.value.playbackRate = message.playbackRate;
          openMessage("同步倍速", 3000);
          console.log("接受rate");
        }
      } else if (message.type === "videoList") {
        videos.value.length = 0;
        videos.value.push(...message.videos);
        openMessage("已刷新文件列表", 3000);
        console.log("接受videoList");
      } else if (message.type === "select") {
        fileName.value = message.fileName;
        selectFile();
        openMessage(`已选择文件`, 3000);
        console.log("接受select");
      }
    }
  });
};

const startPlayback = () => {
  if (videoPlayer.value instanceof HTMLVideoElement && Date.now() - changeMessage.playAndSeek >= 200) {
    socket && socket.send(JSON.stringify({ type: "play", source: UUID, currentTime: videoPlayer.value.currentTime }));
    console.log("发送play");
  }
};

const seekPlayback = () => {
  if (videoPlayer.value instanceof HTMLVideoElement && Date.now() - changeMessage.playAndSeek >= 200) {
    socket && socket.send(JSON.stringify({ type: "seek", source: UUID, currentTime: videoPlayer.value.currentTime }));
    console.log("发送seek", videoPlayer.value.currentTime);
  }
};

const pausePlayback = () => {
  if (videoPlayer.value instanceof HTMLVideoElement && Date.now() - changeMessage.pause >= 200) {
    socket && socket.send(JSON.stringify({ type: "pause", source: UUID, currentTime: videoPlayer.value.currentTime }));
    console.log("发送pause");
  }
};

const rateChangeback = () => {
  if (videoPlayer.value instanceof HTMLVideoElement && Date.now() - changeMessage.rate >= 200) {
    socket && socket.send(JSON.stringify({ type: "rate", source: UUID, playbackRate: videoPlayer.value.playbackRate }));
  }
};

const handleListClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement)?.nodeName === "A") {
    fileName.value = (event.target as HTMLElement).id;
    selectFile();
    if (videoPlayer.value instanceof HTMLVideoElement && Date.now() - changeMessage.pause >= 200) {
      socket && socket.send(JSON.stringify({ type: "select", source: UUID, fileName: fileName.value }));
    }
    // videoPlayer.value?.play();
  }
};

const selectFile = () => {
  const videoUrl = `http://${server.value}/videos/${fileName.value}`; // 替换为服务器上的视频URL
  if (videoPlayer.value instanceof HTMLVideoElement) {
    videoPlayer.value.src = videoUrl;
    videoPlayer.value.load();
  }
};

// 用户必须点击才能控制play 所以需要一个连接动作
// onMounted(() => {
//   handleConnect();
// });
onUnmounted(() => {
  heartbeatInterval && clearInterval(heartbeatInterval);
  socket && socket.close();
});

const updateVideoFiles = () => {
  socket && socket.send(JSON.stringify({ type: "updateVideoFiles", source: UUID }));
};
</script>
<style scoped>
input[type="text"] {
  width: 15em;
  margin: 0.5em;
}
video {
  max-width: 100%; /* 使视频宽度适应容器 */
  max-height: 720px; /* 使视频高度适应容器 */
  width: auto;
  height: auto;
}
.el-notification {
  color: red;
}
ul {
  text-align: left;
}
li {
  cursor: pointer;
}
</style>
