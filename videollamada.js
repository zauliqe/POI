import { db } from "./Firebase.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { currentConversationId, requireAuth } from "./app.js";

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remotePlaceholder = document.getElementById("remotePlaceholder");
const statusText = document.getElementById("callStatus");
const micButton = document.getElementById("toggleMic");
const cameraButton = document.getElementById("toggleCamera");
const hangButton = document.getElementById("hangCall");
const callTitle = document.getElementById("callTitle");
const backToChat = document.getElementById("backToChat");

let me = null;
let stream = null;
let pc = null;
let callDocRef = null;
let candidatesRef = null;
let conversationId = currentConversationId();
let otherUid = "";

const iceServers = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
};

requireAuth(async (user) => {
  me = user;
  if (!conversationId) {
    statusText.textContent = "Abre la llamada desde un chat para enlazarla.";
    return;
  }

  otherUid = getOtherPeerId();
  backToChat.href = `dashboard.html?c=${conversationId}`;
  await startCamera();
  await initCall();
});

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    statusText.textContent = "Cámara lista.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "No se pudo acceder a cámara o micrófono.";
  }
}

function getOtherPeerId() {
  if (!conversationId) return "";
  return conversationId.split("_").find((id) => id && id !== me.uid) || "";
}

async function initCall() {
  callDocRef = doc(db, "llamadas", conversationId);
  candidatesRef = collection(callDocRef, "candidates");

  if (!stream) {
    statusText.textContent = "Necesitas habilitar la cámara antes de iniciar la llamada.";
    return;
  }

  createPeerConnection();
  listenCall();
  listenCandidates();

  const snapshot = await getDoc(callDocRef);
  if (snapshot.exists() && snapshot.data().estado === "finalizada") {
    await clearCandidates();
  }

  if (!snapshot.exists() || snapshot.data()?.estado === "finalizada") {
    await createOffer();
  } else if (snapshot.data().offer && snapshot.data().caller !== me.uid) {
    await answerCall(snapshot.data().offer);
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection(iceServers);

  pc.onicecandidate = async (event) => {
    if (!event.candidate || !candidatesRef) return;
    try {
      await addDoc(candidatesRef, {
        sender: me.uid,
        candidate: event.candidate.toJSON(),
        created: serverTimestamp()
      });
    } catch (error) {
      console.error("Error enviando candidato ICE:", error);
    }
  };

  pc.ontrack = (event) => {
    if (!event.streams || !event.streams[0]) return;
    remoteVideo.srcObject = event.streams[0];
    remotePlaceholder.style.display = "none";
    statusText.textContent = "Conectado.";
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      statusText.textContent = "La llamada está activa.";
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      statusText.textContent = "La conexión se perdió.";
    }
  };

  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  window.addEventListener("beforeunload", () => {
    endCall(true);
  });
}

async function createOffer() {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(callDocRef, {
      conversationId,
      caller: me.uid,
      callee: otherUid,
      estado: "oferta",
      offer: offer.toJSON(),
      actualizada: serverTimestamp()
    }, { merge: true });
    statusText.textContent = "Ofertando llamada. Espera a que el otro usuario responda...";
  } catch (error) {
    console.error("Error creando la oferta:", error);
    statusText.textContent = "No se pudo iniciar la llamada.";
  }
}

async function answerCall(offerData) {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(callDocRef, {
      answer: answer.toJSON(),
      callee: me.uid,
      estado: "respondida",
      actualizada: serverTimestamp()
    }, { merge: true });
    statusText.textContent = "Contestando llamada...";
  } catch (error) {
    console.error("Error creando la respuesta:", error);
    statusText.textContent = "No se pudo responder la llamada.";
  }
}

function listenCall() {
  onSnapshot(callDocRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (data.estado === "finalizada") {
      statusText.textContent = data.finalizadaPor === me.uid
        ? "Llamada finalizada." 
        : "El otro usuario colgó la llamada.";
      hangUpUI();
      return;
    }

    if (data.answer && data.caller === me.uid && pc && !pc.currentRemoteDescription) {
      await setRemoteDescription(data.answer);
    }

    if (data.offer && data.caller !== me.uid && !data.answer) {
      await answerCall(data.offer);
    }
  });
}

function listenCandidates() {
  const candidatesQuery = query(candidatesRef, orderBy("created"));
  onSnapshot(candidatesQuery, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type !== "added") return;
      const candidateData = change.doc.data();
      if (candidateData.sender === me.uid) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData.candidate));
      } catch (error) {
        console.error("Error agregando candidato remoto:", error);
      }
    });
  });
}

async function clearCandidates() {
  try {
    const snapshot = await getDocs(candidatesRef);
    const batch = writeBatch(db);
    snapshot.forEach((candidateDoc) => batch.delete(candidateDoc.ref));
    await batch.commit();
  } catch (error) {
    console.error("Error limpiando candidatos ICE:", error);
  }
}

async function setRemoteDescription(answerData) {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answerData));
    statusText.textContent = "Llamada conectada.";
  } catch (error) {
    console.error("Error al establecer la descripción remota:", error);
  }
}

async function endCall(isUnload = false) {
  try {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remotePlaceholder.style.display = "grid";

    if (!isUnload && callDocRef) {
      await setDoc(callDocRef, {
        estado: "finalizada",
        finalizadaPor: me.uid,
        actualizada: serverTimestamp()
      }, { merge: true });
    }
  } catch (error) {
    console.error("Error terminando la llamada:", error);
  }
}

function hangUpUI() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remotePlaceholder.style.display = "grid";
}

micButton.addEventListener("click", () => {
  const audioTrack = stream?.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  micButton.textContent = audioTrack.enabled ? "Micrófono" : "Micrófono off";
});

cameraButton.addEventListener("click", () => {
  const videoTrack = stream?.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  cameraButton.textContent = videoTrack.enabled ? "Cámara" : "Cámara off";
});

hangButton.addEventListener("click", async () => {
  await endCall();
  window.location.href = backToChat.href;
});
