import { db } from "./Firebase.js";
import { currentConversationId, requireAuth } from "./app.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const localVideo = document.getElementById("localVideo");
const remotePanel = document.getElementById("remotePanel");
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
let callDoc = null;
let conversationId = currentConversationId();
let isCaller = false;
let localAudioTrack = null;
let localVideoTrack = null;
let offerCandidatesCollection = null;
let answerCandidatesCollection = null;
let answerListener = null;
let candidatesListener = null;
let callDocListener = null;

requireAuth(async (user) => {
  me = user;
  if (!conversationId) {
    statusText.textContent = "Abre la llamada desde un chat para enlazarla.";
    return;
  }

  backToChat.href = `dashboard.html?c=${conversationId}`;
  await startCamera();
  await initCall();
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    localAudioTrack = stream.getAudioTracks()[0] || null;
    localVideoTrack = stream.getVideoTracks()[0] || null;
    statusText.textContent = "Cámara lista. Esperando la llamada.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "No se pudo acceder a cámara o micrófono.";
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;
    const candidateData = event.candidate.toJSON();
    const targetCollection = isCaller ? offerCandidatesCollection : answerCandidatesCollection;
    await addDoc(targetCollection, { candidate: candidateData, createdAt: serverTimestamp() });
  };

  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.classList.remove("hidden");
      remotePanel.classList.add("hidden");
      statusText.textContent = "Conexión establecida. Video remoto activo.";
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") {
      statusText.textContent = "Conectado. Conversación establecida.";
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      statusText.textContent = "Conexión perdida. Esperando reconexión...";
    } else if (pc.connectionState === "closed") {
      statusText.textContent = "Llamada finalizada.";
    }
  };

  return pc;
}

async function initCall() {
  callDoc = doc(db, "llamadas", conversationId);
  const callSnapshot = await getDoc(callDoc);
  pc = createPeerConnection();

  if (!stream) {
    statusText.textContent = "No hay cámara local disponible.";
    return;
  }

  stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  offerCandidatesCollection = collection(callDoc, "callerCandidates");
  answerCandidatesCollection = collection(callDoc, "calleeCandidates");

  if (!callSnapshot.exists() || !callSnapshot.data()?.offer) {
    isCaller = true;
    statusText.textContent = "Creando oferta de videollamada...";
    await startCallerFlow();
  } else {
    isCaller = false;
    statusText.textContent = "Recibiendo la llamada...";
    await startCalleeFlow(callSnapshot.data());
  }

  listenCallState();
}

async function startCallerFlow() {
  answerListener = onSnapshot(callDoc, async (snapshot) => {
    const data = snapshot.data();
    if (!data || !data.answer || !pc) return;
    if (pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    statusText.textContent = "Respuesta recibida. Conectando...";
  });

  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  await setDoc(callDoc, {
    conversationId,
    estado: "activa",
    iniciadaPor: me.uid,
    callerId: me.uid,
    offer: offerDescription.toJSON(),
    actualizada: serverTimestamp()
  }, { merge: true });

  listenForRemoteCandidates(answerCandidatesCollection);
}

async function startCalleeFlow(data) {
  const offer = data.offer;
  if (!offer) {
    statusText.textContent = "La oferta no está disponible. Intenta iniciar la llamada otra vez.";
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  await setDoc(callDoc, {
    estado: "activa",
    calleeId: me.uid,
    answer: answerDescription.toJSON(),
    actualizada: serverTimestamp()
  }, { merge: true });

  listenForRemoteCandidates(offerCandidatesCollection);
}

function listenForRemoteCandidates(candidateCollection) {
  candidatesListener = onSnapshot(query(candidateCollection), async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type !== "added") return;
      const data = change.doc.data();
      if (data && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
          console.warn("Error agregando candidato ICE:", error);
        }
      }
    });
  });
}

function listenCallState() {
  callDocListener = onSnapshot(callDoc, (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    callTitle.textContent = data.estado === "finalizada" ? "Llamada finalizada" : "Videollamada";
    if (data.estado === "finalizada") {
      statusText.textContent = "La llamada fue finalizada.";
      cleanupPeerConnection();
    }
  });
}

async function cleanupPeerConnection() {
  if (pc) {
    pc.getSenders().forEach((sender) => {
      if (sender.track) sender.track.stop();
    });
    pc.close();
    pc = null;
  }

  if (callDocListener) callDocListener();
  if (answerListener) answerListener();
  if (candidatesListener) candidatesListener();
}

micButton.addEventListener("click", () => {
  if (!localAudioTrack) return;
  localAudioTrack.enabled = !localAudioTrack.enabled;
  micButton.textContent = localAudioTrack.enabled ? "Micrófono" : "Micrófono off";
});

cameraButton.addEventListener("click", () => {
  if (!localVideoTrack) return;
  localVideoTrack.enabled = !localVideoTrack.enabled;
  cameraButton.textContent = localVideoTrack.enabled ? "Cámara" : "Cámara off";
});

hangButton.addEventListener("click", async () => {
  if (conversationId) {
    await setDoc(callDoc, {
      estado: "finalizada",
      finalizadaPor: me.uid,
      actualizada: serverTimestamp()
    }, { merge: true });
  }

  stream?.getTracks().forEach((track) => track.stop());
  cleanupPeerConnection();
  window.location.href = backToChat.href;
});
