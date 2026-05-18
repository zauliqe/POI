import { db } from "./Firebase.js";
import { currentConversationId, requireAuth } from "./app.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusText = document.getElementById("callStatus");
const micButton = document.getElementById("toggleMic");
const cameraButton = document.getElementById("toggleCamera");
const hangButton = document.getElementById("hangCall");
const callTitle = document.getElementById("callTitle");
const backToChat = document.getElementById("backToChat");

let me = null;
let stream = null;
let pc = null;
let conversationId = currentConversationId();
let callRef = null;
let remoteCandidatesUnsubscribe = null;
let callDocUnsubscribe = null;
let isCaller = false;
let answerCreated = false;

requireAuth(async (user) => {
  me = user;
  if (!conversationId) {
    statusText.textContent = "No se encontró identificador de videollamada.";
    return;
  }

  backToChat.href = `dashboard.html?c=${conversationId}`;
  callRef = doc(db, "llamadas", conversationId);

  await startCamera();
  await initCall();
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    localVideo.play().catch(() => {});
    statusText.textContent = "Cámara lista. Preparando llamada...";
  } catch (error) {
    console.error(error);
    statusText.textContent = "No se pudo acceder a cámara o micrófono.";
  }
}

async function initCall() {
  const snap = await getDoc(callRef);
  if (!snap.exists()) {
    statusText.textContent = "No se encontró la llamada. Inicia la videollamada desde el chat.";
    return;
  }

  const callData = snap.data();
  isCaller = callData.caller === me.uid;
  const remoteName = isCaller ? callData.calleeName : callData.callerName;
  callTitle.textContent = remoteName ? `Videollamada con ${remoteName}` : "Videollamada";

  createPeerConnection();
  listenToCallDocument();
  listenRemoteIceCandidates();

  if (isCaller) {
    if (!callData.offer) {
      await createOffer();
    } else {
      statusText.textContent = "Esperando respuesta...";
    }
  } else {
    if (callData.offer) {
      await answerCall(callData.offer);
    } else {
      statusText.textContent = "Esperando oferta del llamante...";
    }
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await addIceCandidate(event.candidate);
    }
  };

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
      remoteVideo.play().catch(() => {});
      statusText.textContent = "Conectado";
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      statusText.textContent = "Conectado";
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      statusText.textContent = "La conexión se interrumpió.";
    } else if (pc.connectionState === "closed") {
      statusText.textContent = "Llamada finalizada.";
    }
  };

  stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
}

function listenToCallDocument() {
  callDocUnsubscribe = onSnapshot(callRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (isCaller && data.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      statusText.textContent = "Conectando...";
    }

    if (!isCaller && data.offer && !answerCreated) {
      await answerCall(data.offer);
    }

    if (data.estado === "finalizada") {
      statusText.textContent = "La llamada terminó.";
      closeConnection();
    }

    if (data.estado === "rechazada") {
      statusText.textContent = "La llamada fue rechazada.";
      closeConnection();
    }
  });
}

function listenRemoteIceCandidates() {
  const candidatesCollection = collection(callRef, isCaller ? "calleeCandidates" : "callerCandidates");
  remoteCandidatesUnsubscribe = onSnapshot(candidatesCollection, async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added") {
        const candidate = change.doc.data();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error("Error agregando candidato remoto:", error);
        }
      }
    }
  });
}

async function createOffer() {
  if (!pc) return;
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);
  await setDoc(callRef, {
    offer: {
      type: offerDescription.type,
      sdp: offerDescription.sdp
    },
    estado: "activa",
    updatedAt: serverTimestamp()
  }, { merge: true });
  statusText.textContent = "Llamando...";
}

async function answerCall(offer) {
  if (!pc) return;
  answerCreated = true;
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);
  await setDoc(callRef, {
    answer: {
      type: answerDescription.type,
      sdp: answerDescription.sdp
    },
    estado: "activa",
    updatedAt: serverTimestamp()
  }, { merge: true });
  statusText.textContent = "Conectando...";
}

async function addIceCandidate(candidate) {
  await addDoc(collection(callRef, isCaller ? "callerCandidates" : "calleeCandidates"), candidate.toJSON());
}

async function endCall() {
  if (callRef) {
    await setDoc(callRef, {
      estado: "finalizada",
      finalizadaPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  closeConnection();
}

function closeConnection() {
  if (remoteCandidatesUnsubscribe) remoteCandidatesUnsubscribe();
  if (callDocUnsubscribe) callDocUnsubscribe();
  pc?.close();
  pc = null;
  stream?.getTracks().forEach((track) => track.stop());
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
  await endCall();
  window.location.href = backToChat.href;
});

window.addEventListener("beforeunload", async (event) => {
  if (callRef) {
    event.preventDefault();
    await endCall();
  }
});
