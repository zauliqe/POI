import { db } from "./Firebase.js";
import { currentConversationId, requireAuth } from "./app.js";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const localVideo = document.getElementById("localVideo");
const remotePanel = document.getElementById("remotePanel");
const statusText = document.getElementById("callStatus");
const micButton = document.getElementById("toggleMic");
const cameraButton = document.getElementById("toggleCamera");
const hangButton = document.getElementById("hangCall");
const callTitle = document.getElementById("callTitle");
const backToChat = document.getElementById("backToChat");

let me = null;
let stream = null;
let conversationId = currentConversationId();

requireAuth(async (user) => {
  me = user;
  if (conversationId) {
    backToChat.href = `dashboard.html?c=${conversationId}`;
    await setDoc(doc(db, "llamadas", conversationId), {
      conversationId,
      estado: "activa",
      iniciadaPor: user.uid,
      actualizada: serverTimestamp()
    }, { merge: true });
    listenCall();
  } else {
    statusText.textContent = "Abre la llamada desde un chat para enlazarla.";
  }
  startCamera();
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    statusText.textContent = conversationId ? "Cámara lista. Señalización preparada." : "Cámara lista.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "No se pudo acceder a cámara o micrófono.";
  }
}

function listenCall() {
  onSnapshot(doc(db, "llamadas", conversationId), (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    callTitle.textContent = data.estado === "finalizada" ? "Llamada finalizada" : "Videollamada";
    remotePanel.textContent = data.estado === "finalizada"
      ? "La llamada terminó."
      : "Esperando al otro usuario. Aquí va el video remoto cuando se agregue WebRTC completo.";
  });
}

micButton.addEventListener("click", () => {
  const audio = stream?.getAudioTracks()[0];
  if (!audio) return;
  audio.enabled = !audio.enabled;
  micButton.textContent = audio.enabled ? "Micrófono" : "Micrófono off";
});

cameraButton.addEventListener("click", () => {
  const video = stream?.getVideoTracks()[0];
  if (!video) return;
  video.enabled = !video.enabled;
  cameraButton.textContent = video.enabled ? "Cámara" : "Cámara off";
});

hangButton.addEventListener("click", async () => {
  stream?.getTracks().forEach((track) => track.stop());
  if (conversationId) {
    await setDoc(doc(db, "llamadas", conversationId), {
      estado: "finalizada",
      finalizadaPor: me.uid,
      actualizada: serverTimestamp()
    }, { merge: true });
  }
  window.location.href = backToChat.href;
});
