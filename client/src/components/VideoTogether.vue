<template>
  <div>
    <form v-show="socketStatus !== SocketStatus.success">
      {{ client }}
      主机：<input
        type="text"
        v-model="server"
      />
      <input
        type="button"
        value="连接"
        @click="handleConnect"
      />
      <p>{{ socketStatus }}</p>
    </form>
    <div v-show="socketStatus === SocketStatus.success">
      <p v-show="srcFileName">
        正在播放
        <strong>{{ srcFileName }}</strong>
      </p>
      <p>房间人数: {{ userCount }}</p>
      <video
        ref="videoPlayer"
        preload="auto"
        controls
        @play="startPlayback"
        @pause="pausePlayback"
        @seeked="seekPlayback"
        @ratechange="rateChangeback"
      ></video>
    </div>
    <div>
      <ul>
        <li
          v-for="item in videos"
          @click="handleListClick"
        >
          <a :id="item"> {{ item }}</a>
        </li>
      </ul>
      <button
        v-show="socketStatus === SocketStatus.success"
        @click="updateVideoFiles"
      >
        刷新文件列表
      </button>
      <p>版本: v1.0.1.0</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Ref, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { ElNotification } from "element-plus";
import { v4 as uuidv4 } from "uuid";

enum SocketStatus {
  connecting = "正在连接",
  success = "连接成功",
  failed = "连接失败",
}

const userCount = ref(0);
const videoPlayer: Ref<HTMLVideoElement | null> = ref(null);
const server = useStorage("video-together-server", "127.0.0.1:3000", localStorage);
const client = "";
let ws: WebSocket;
let socketStatus = ref<SocketStatus>();
const UUID = uuidv4();
const videos: Ref<string[]> = ref([]);
const srcFileName = ref("");

const openMessage = (message: string, duration = 1000) => {
  ElNotification.closeAll();
  return ElNotification({ message, duration, showClose: false }).close;
};

const heartCheck = {
  timeout: 30000,
  timeoutObj: 0,
  serverTimeoutObj: 0,
  reset: function () {
    if (this.serverTimeoutObj) clearTimeout(this.serverTimeoutObj);
    console.log("存活");
    return this;
  },
  stop: function () {
    console.log("心跳包stop");
    if (this.timeoutObj) clearInterval(this.timeoutObj);
    if (this.serverTimeoutObj) clearTimeout(this.serverTimeoutObj);
    return this;
  },
  start: function () {
    var self = this;
    this.timeoutObj = setInterval(function () {
      //这里发送一个心跳，后端收到后，返回一个心跳消息，
      //onmessage拿到返回的心跳就说明连接正常
      ws && ws.send(JSON.stringify({ type: "hreatcheck", source: UUID }));
      // console.log("ping!");
      self.serverTimeoutObj = setTimeout(function () {
        //如果超过一定时间还没重置，说明后端主动断开了
        console.error("ws close");
        ws.close(); //如果onclose会执行reconnect，我们执行ws.close()就行了.如果直接执行reconnect 会触发onclose导致重连两次
      }, self.timeout);
    }, this.timeout);
  },
};

const just = {
  playOrSeek: false,
  pause: false,
  rate: false,
};

const messageDuration = 2000;

const handleConnect = () => {
  server.value = server.value.trim();
  ws = new WebSocket(`ws://${server.value}`);
  socketStatus.value = SocketStatus.connecting;
  let el: Function | null = null;
  ws.addEventListener("open", () => {
    socketStatus.value = SocketStatus.success;
    heartCheck.start();
    el && el();
  });

  ws.addEventListener("close", () => {
    el = ElNotification({
      title: "错误",
      message: "连接已断开",
      type: "error",
      duration: 0,
    }).close;
    socketStatus.value = SocketStatus.failed;
    heartCheck.stop();
  });

  ws.addEventListener("error", () => {
    socketStatus.value = SocketStatus.failed;
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hreatcheck") {
      heartCheck.reset();
    }
    if (videoPlayer.value) {
      if (message.type === "userCount") {
        userCount.value = message.count;
      } else if (message.type === "init") {
        const { currentTime, fileName, type, videoList } = message.initData;

        just.pause = true;
        just.playOrSeek = true;
        just.rate = true;

        // videoList
        videos.value.length = 0;
        videos.value.push(...videoList);

        // fileName
        srcFileName.value = fileName;
        if (srcFileName.value !== "") loadSrc();

        // currentTime
        videoPlayer.value.currentTime = currentTime + 0.5;

        videoPlayer.value.volume = 0.5;

        // play or pause
        if (type === "play") videoPlayer.value.play();
        else videoPlayer.value.pause();

        console.log("init", type, fileName, currentTime);

        setTimeout(() => {
          just.pause = false;
          just.playOrSeek = false;
          just.rate = false;
        }, 500);
      } else if (message.source !== UUID) {
        if (message.type === "play") {
          if (Math.abs(videoPlayer.value.currentTime - message.currentTime) > 2) {
            videoPlayer.value.currentTime = message.currentTime;
          }
          if (videoPlayer.value.paused) {
            videoPlayer.value.play();
            console.log("接受play", message.currentTime);
            openMessage("播放", messageDuration);
          }
          just.playOrSeek = true;
        }
        if (message.type === "seek") {
          just.playOrSeek = true;
          if (Math.abs(videoPlayer.value.currentTime - message.currentTime) > 2) {
            console.log("接受seek", message.currentTime);
            videoPlayer.value.currentTime = message.currentTime;
            openMessage("同步进度", messageDuration);
          }
        }
        if (message.type === "pause") {
          just.pause = true;
          videoPlayer.value.pause();
          openMessage("暂停", messageDuration);
          console.log("接受pause");
        }
        if (message.type === "rate") {
          just.rate = true;
          if (!Number.isNaN(message.playbackRate)) {
            videoPlayer.value.playbackRate = message.playbackRate;
            openMessage("同步倍速", messageDuration);
            console.log("接受rate");
          }
        }
        if (message.type === "videoList") {
          videos.value.length = 0;
          videos.value.push(...message.videos);
          openMessage("已刷新文件列表", messageDuration);
          console.log("接受videoList");
        }
        if (message.type === "select") {
          srcFileName.value = message.fileName;
          loadSrc();
          openMessage(`已选择文件`, messageDuration);
          console.log("接受select");
        }
      }
    }
  });
};

const startPlayback = () => {
  if (!just.playOrSeek) {
    ws && ws.send(JSON.stringify({ type: "play", source: UUID, currentTime: videoPlayer.value!.currentTime }));
    console.log("发送play", videoPlayer.value!.currentTime);
  }
  setTimeout(() => {
    just.playOrSeek = false;
  }, 500);
};

const seekPlayback = () => {
  if (!just.playOrSeek && !videoPlayer.value!.paused) {
    ws && ws.send(JSON.stringify({ type: "seek", source: UUID, currentTime: videoPlayer.value!.currentTime }));
    console.log("发送seek", videoPlayer.value!.currentTime);
  }
  setTimeout(() => {
    just.playOrSeek = false;
  }, 500);
};

const pausePlayback = () => {
  if (!just.pause) {
    ws && ws.send(JSON.stringify({ type: "pause", source: UUID, currentTime: videoPlayer.value!.currentTime }));
    console.log("发送pause", videoPlayer.value!.currentTime);
  }
  just.pause = false;
};

const rateChangeback = () => {
  if (!just.rate) {
    ws && ws.send(JSON.stringify({ type: "rate", source: UUID, playbackRate: videoPlayer.value!.playbackRate }));
    console.log("发送rate", videoPlayer.value!.playbackRate);
  }
  just.rate = false;
};

const handleListClick = (event: MouseEvent) => {
  if ((event.target as HTMLElement)?.nodeName === "A") {
    srcFileName.value = (event.target as HTMLElement).id;
    loadSrc();
    if (videoPlayer.value! instanceof HTMLVideoElement) {
      ws && ws.send(JSON.stringify({ type: "select", source: UUID, fileName: srcFileName.value }));
      console.log("发送select", srcFileName.value);
    }
  }
};

const loadSrc = () => {
  const videoUrl = `http://${server.value}/videos/${srcFileName.value}`; // 替换为服务器上的视频URL
  videoPlayer.value!.src = videoUrl;
  videoPlayer.value!.load();
};

const updateVideoFiles = () => {
  ws && ws.send(JSON.stringify({ type: "updateVideoFiles", source: UUID }));
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
