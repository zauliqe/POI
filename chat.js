import { db } from "./Firebase.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { currentConversationId, formatDate, initials, isUserOnline, privateConversationId, requireAuth } from "./app.js";
const sendButton = document.getElementById("enviar");
const input = document.getElementById("mensaje");
const chat = document.getElementById("chat");
const contacts = document.getElementById("contactsList");
const groups = document.getElementById("groupsList");
const title = document.getElementById("chatTitle");
const subtitle = document.getElementById("chatSubtitle");
const headerAvatar = document.getElementById("chatAvatar");
const callLink = document.getElementById("callLink");
const headerElement = document.querySelector(".topbar");
const incomingCallBanner = document.createElement("div");

const userColors = ["#256f5c", "#355f9d", "#7a4d92", "#8a6333", "#8a3f5d", "#4f6f36", "#6b5a2f"];

let me = null;
let profile = null;
let activeConversation = null;
let stopMessages = null;
let activeIncomingCallId = null;

let callOverlay = null;
let callModal = null;
let callLocalVideo = null;
let callRemoteVideo = null;
let callStatusLabel = null;
let callToggleMicBtn = null;
let callToggleCameraBtn = null;
let callHangBtn = null;
let callCloseBtn = null;
let currentCallRef = null;
let callPeerConnection = null;
let localStream = null;
let isCaller = false;
let callOpen = false;
let callDocUnsubscribe = null;
let iceCandidatesUnsubscribe = null;

createCallOverlay();
callLink.addEventListener("click", handleCallClick);

requireAuth(async (user, userProfile) => {
  me = user;
  profile = userProfile;
  bindUsers();
  bindGroups();
  setupIncomingCallBanner();
  listenIncomingCalls();

  const conversationFromUrl = currentConversationId();
  if (conversationFromUrl) {
    await openConversation(conversationFromUrl);
  } else {
    showEmpty("Selecciona un contacto o grupo para empezar.");
  }
});

function createCallOverlay() {
  callOverlay = document.createElement("div");
  callOverlay.id = "callOverlay";
  callOverlay.className = "callOverlay hidden";

  callOverlay.innerHTML = `
    <div class="callModal">
      <div class="callModalHeader">
        <div>
          <div class="callModalTitle">Videollamada</div>
          <div class="callStatusLabel">Esperando...</div>
        </div>
      </div>
      <div class="callVideoGrid">
        <div class="callVideoCard">
          <div class="videoLabel">Mi cámara</div>
          <video id="callLocalVideo" class="callVideo" autoplay muted playsinline></video>
        </div>
        <div class="callVideoCard">
          <div class="videoLabel">Remoto</div>
          <video id="callRemoteVideo" class="callVideo" autoplay playsinline></video>
        </div>
      </div>
      <div class="callControls">
        <button id="callToggleCamera" class="btn small">Cámara</button>
        <button id="callToggleMic" class="btn small">Micrófono</button>
        <button id="callHangBtn" class="btn danger small">Colgar</button>
        <button id="callCloseBtn" class="btn ghost small">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(callOverlay);
  callModal = callOverlay.querySelector(".callModal");
  callLocalVideo = callOverlay.querySelector("#callLocalVideo");
  callRemoteVideo = callOverlay.querySelector("#callRemoteVideo");
  callStatusLabel = callOverlay.querySelector(".callStatusLabel");
  callToggleMicBtn = callOverlay.querySelector("#callToggleMic");
  callToggleCameraBtn = callOverlay.querySelector("#callToggleCamera");
  callHangBtn = callOverlay.querySelector("#callHangBtn");
  callCloseBtn = callOverlay.querySelector("#callCloseBtn");

  callToggleMicBtn.addEventListener("click", toggleLocalAudio);
  callToggleCameraBtn.addEventListener("click", toggleLocalVideo);
  callHangBtn.addEventListener("click", endCallSession);
  callCloseBtn.addEventListener("click", closeCallModal);
}

function showCallModal() {
  callOverlay.classList.remove("hidden");
  callOpen = true;
}

function closeCallModal() {
  callOverlay.classList.add("hidden");
  callOpen = false;
}

function setCallStatus(text) {
  if (callStatusLabel) callStatusLabel.textContent = text;
}

async function handleCallClick(event) {
  event.preventDefault();
  if (callLink.classList.contains("disabled") || !activeConversation) return;
  if (activeConversation.tipo !== "privado") {
    alert("La videollamada solo funciona en chats privados.");
    return;
  }
  const otherUid = activeConversation.miembros?.find((uid) => uid !== me.uid);
  if (!otherUid) {
    alert("No se pudo detectar al otro participante.");
    return;
  }
  await createCallRequest(otherUid);
}

async function createCallRequest(calleeUid) {
  const callRef = doc(db, "llamadas", activeConversation.id);
  const callSnap = await getDoc(callRef);
  const previous = callSnap.exists() ? callSnap.data() : null;
  if (previous?.estado === "invitando" || previous?.estado === "activa") {
    alert("Ya hay una llamada en curso en esta conversación.");
    return;
  }

  await setDoc(callRef, {
    conversationId: activeConversation.id,
    caller: me.uid,
    callee: calleeUid,
    callerName: profile.nombre || profile.usuario || "Yo",
    calleeName: activeConversation.nombres?.[calleeUid] || "Usuario",
    estado: "invitando",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await openCallModal(activeConversation.id, true);
}

async function openCallModal(callId, callerRole) {
  if (callOpen) return;
  isCaller = callerRole;
  currentCallRef = doc(db, "llamadas", callId);
  showCallModal();
  await startLocalMedia();
  await initCallSession(callId);
}

async function respondToIncomingCall(callId) {
  await setDoc(doc(db, "llamadas", callId), {
    estado: "activa",
    acceptedAt: serverTimestamp(),
    aceptadaPor: me.uid,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await openCallModal(callId, false);
}

async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (callLocalVideo) {
      callLocalVideo.srcObject = localStream;
      await callLocalVideo.play().catch(() => {});
    }
    setCallStatus("Cámara lista. Iniciando llamada...");
  } catch (error) {
    console.error("Error al obtener cámara:", error);
    setCallStatus("No se pudo acceder a cámara o micrófono.");
  }
}

async function initCallSession(callId) {
  const snap = await getDoc(currentCallRef);
  if (!snap.exists()) {
    setCallStatus("La llamada no existe.");
    return;
  }

  const callData = snap.data();
  isCaller = callData.caller === me.uid;
  const remoteName = isCaller ? callData.calleeName : callData.callerName;
  callModal.querySelector(".callModalTitle").textContent = remoteName ? `Videollamada con ${remoteName}` : "Videollamada";

  createPeerConnection();
  listenCallDocument();
  listenRemoteIceCandidates();

  if (isCaller) {
    if (!callData.offer) {
      await createOffer();
    } else {
      setCallStatus("Esperando respuesta...");
    }
  } else {
    if (callData.offer) {
      await answerCall(callData.offer);
    } else {
      setCallStatus("Esperando oferta del llamante...");
    }
  }
}

function createPeerConnection() {
  if (callPeerConnection) return;
  callPeerConnection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  callPeerConnection.onicecandidate = async (event) => {
    if (event.candidate) await addIceCandidate(event.candidate);
  };

  callPeerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (callRemoteVideo && remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      setCallStatus("Conectado");
    }
  };

  callPeerConnection.onconnectionstatechange = () => {
    if (!callPeerConnection) return;
    const state = callPeerConnection.connectionState;
    if (state === "connected") setCallStatus("Conectado");
    else if (state === "disconnected" || state === "failed") setCallStatus("La conexión se interrumpió.");
    else if (state === "closed") setCallStatus("Llamada finalizada.");
  };

  localStream?.getTracks().forEach((track) => callPeerConnection.addTrack(track, localStream));
}

function listenCallDocument() {
  if (callDocUnsubscribe) callDocUnsubscribe();
  callDocUnsubscribe = onSnapshot(currentCallRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (data.estado === "finalizada") {
      setCallStatus("La llamada terminó.");
      stopCallSession();
      return;
    }

    if (data.estado === "rechazada") {
      setCallStatus("La llamada fue rechazada.");
      stopCallSession();
      return;
    }

    if (isCaller && data.answer && callPeerConnection && !callPeerConnection.currentRemoteDescription) {
      await callPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      setCallStatus("Conectando...");
    }

    if (!isCaller && data.offer && !callPeerConnection?.currentRemoteDescription) {
      await answerCall(data.offer);
    }
  });
}

function listenRemoteIceCandidates() {
  if (iceCandidatesUnsubscribe) iceCandidatesUnsubscribe();
  const collectionRef = collection(currentCallRef, isCaller ? "calleeCandidates" : "callerCandidates");
  iceCandidatesUnsubscribe = onSnapshot(collectionRef, async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added") {
        const candidate = change.doc.data();
        try {
          await callPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error("Error agregando candidato remoto:", error);
        }
      }
    }
  });
}

async function createOffer() {
  if (!callPeerConnection) return;
  const offerDescription = await callPeerConnection.createOffer();
  await callPeerConnection.setLocalDescription(offerDescription);
  await setDoc(currentCallRef, {
    offer: { type: offerDescription.type, sdp: offerDescription.sdp },
    estado: "activa",
    updatedAt: serverTimestamp()
  }, { merge: true });
  setCallStatus("Llamando...");
}

async function answerCall(offer) {
  if (!callPeerConnection) return;
  await callPeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answerDescription = await callPeerConnection.createAnswer();
  await callPeerConnection.setLocalDescription(answerDescription);
  await setDoc(currentCallRef, {
    answer: { type: answerDescription.type, sdp: answerDescription.sdp },
    estado: "activa",
    updatedAt: serverTimestamp()
  }, { merge: true });
  setCallStatus("Conectando...");
}

async function addIceCandidate(candidate) {
  await addDoc(collection(currentCallRef, isCaller ? "callerCandidates" : "calleeCandidates"), candidate.toJSON());
}

async function endCallSession() {
  if (currentCallRef) {
    await setDoc(currentCallRef, {
      estado: "finalizada",
      finalizadaPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  stopCallSession();
  closeCallModal();
}

function stopCallSession() {
  if (iceCandidatesUnsubscribe) iceCandidatesUnsubscribe();
  if (callDocUnsubscribe) callDocUnsubscribe();
  callPeerConnection?.close();
  callPeerConnection = null;
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  if (callLocalVideo) callLocalVideo.srcObject = null;
  if (callRemoteVideo) callRemoteVideo.srcObject = null;
}

function toggleLocalAudio() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  callToggleMicBtn.textContent = audioTrack.enabled ? "Micrófono" : "Micrófono off";
}

function toggleLocalVideo() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  callToggleCameraBtn.textContent = videoTrack.enabled ? "Cámara" : "Cámara off";
}

function setupIncomingCallBanner() {
  incomingCallBanner.id = "incomingCall";
  incomingCallBanner.className = "incomingCall hidden";
  if (headerElement?.parentNode) {
    headerElement.parentNode.insertBefore(incomingCallBanner, headerElement.nextSibling);
  }
}

function listenIncomingCalls() {
  const incomingQuery = query(
    collection(db, "llamadas"),
    where("callee", "==", me.uid),
    where("estado", "==", "invitando")
  );

  onSnapshot(incomingQuery, (snapshot) => {
    if (snapshot.empty) {
      hideIncomingCall();
      return;
    }

    const callDoc = snapshot.docs[0];
    showIncomingCall(callDoc.id, callDoc.data());
  }, (error) => {
    console.error("Error al escuchar llamadas entrantes:", error);
  });
}

function showIncomingCall(callId, callData) {
  if (activeIncomingCallId === callId) return;
  activeIncomingCallId = callId;

  incomingCallBanner.innerHTML = `
    <div style="flex:1; min-width:0;">
      <strong style="display:block; color:var(--text);">Llamada entrante</strong>
      <span style="display:block; color:var(--muted); margin-top:4px;">${escapeHtml(callData.callerName || "Alguien")} te está llamando.</span>
    </div>
    <div class="callActions">
      <button class="btn small primary" id="acceptCallBtn">Aceptar</button>
      <button class="btn small danger" id="rejectCallBtn">Rechazar</button>
    </div>
  `;

  incomingCallBanner.classList.remove("hidden");

  const acceptBtn = document.getElementById("acceptCallBtn");
  const rejectBtn = document.getElementById("rejectCallBtn");

  acceptBtn?.addEventListener("click", async () => {
    await respondToIncomingCall(callId);
    hideIncomingCall();
  });

  rejectBtn?.addEventListener("click", async () => {
    await setDoc(doc(db, "llamadas", callId), {
      estado: "rechazada",
      rechazadoPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
    hideIncomingCall();
  });
}

function showEmpty(message) {
  activeConversation = null;
  title.textContent = "Chats";
  subtitle.textContent = message;
  headerAvatar.textContent = "C";
  callLink.classList.add("disabled");
  chat.innerHTML = `<div class="emptyState">${message}</div>`;
}

function bindUsers() {
  onSnapshot(collection(db, "usuarios"), (snapshot) => {
    contacts.innerHTML = "";
    const users = snapshot.docs
      .map((item) => ({ uid: item.id, ...item.data() }))
      .filter((user) => user.uid !== me.uid)
      .sort((a, b) => (a.nombre || a.usuario || "").localeCompare(b.nombre || b.usuario || ""));

    users.forEach((user) => contacts.appendChild(contactItem(user)));

    if (!contacts.children.length) {
      contacts.innerHTML = `<div class="mutedBlock">Cuando alguien se registre, aparecerá aquí para abrir chat individual.</div>`;
    }
  }, (error) => {
    console.error("Error al cargar usuarios:", error);
    contacts.innerHTML = `<div class="mutedBlock">No se pudieron cargar usuarios.</div>`;
  });
}

function bindGroups() {
  const q = query(collection(db, "grupos"), where("miembros", "array-contains", me.uid));
  onSnapshot(q, (snapshot) => {
    groups.innerHTML = "";
    snapshot.forEach((item) => {
      groups.appendChild(groupItem({ id: item.id, ...item.data() }));
    });

    if (!groups.children.length) {
      groups.innerHTML = `<a class="item" href="crear-grupo.html"><div class="avatar">+</div><div><div class="name">Crear grupo</div><div class="meta">Todavía no tienes grupos</div></div></a>`;
    }
  }, (error) => {
    console.error("Error al cargar grupos:", error);
    groups.innerHTML = `<div class="mutedBlock">No se pudieron cargar grupos.</div>`;
  });
}

function contactItem(user) {
  const online = isUserOnline(user);
  const id = privateConversationId(me.uid, user.uid);
  const item = document.createElement("a");
  item.className = `item ${activeConversation?.id === id ? "active" : ""}`;
  item.href = `dashboard.html?c=${id}`;
  item.innerHTML = `
    <div class="avatar withStatus">${initials(user.nombre || user.usuario)}<span class="statusDot ${online ? "online" : ""}"></span></div>
    <div class="itemText">
      <div class="name">${escapeHtml(user.nombre || user.usuario || "Usuario")}</div>
      <div class="meta">${online ? "En línea" : "Desconectado"} · @${escapeHtml(user.usuario || "usuario")}</div>
    </div>
  `;
  item.addEventListener("click", async (event) => {
    event.preventDefault();
    await ensurePrivateConversation(user);
    history.replaceState(null, "", `dashboard.html?c=${id}`);
    await openConversation(id);
  });
  return item;
}

function groupItem(group) {
  const item = document.createElement("a");
  item.className = `item ${activeConversation?.id === group.id ? "active" : ""}`;
  item.href = `dashboard.html?c=${group.id}`;
  item.innerHTML = `
    <div class="avatar">${initials(group.nombre || "Grupo")}</div>
    <div class="itemText">
      <div class="name">${escapeHtml(group.nombre || "Grupo")}</div>
      <div class="meta">${group.miembros?.length || 0} miembros · ${escapeHtml(group.tipo || "Privado")}</div>
    </div>
  `;
  item.addEventListener("click", async (event) => {
    event.preventDefault();
    history.replaceState(null, "", `dashboard.html?c=${group.id}`);
    await openConversation(group.id);
  });
  return item;
}

async function ensurePrivateConversation(user) {
  const id = privateConversationId(me.uid, user.uid);
  await setDoc(doc(db, "conversaciones", id), {
    tipo: "privado",
    miembros: [me.uid, user.uid],
    nombres: {
      [me.uid]: profile.nombre || profile.usuario || "Yo",
      [user.uid]: user.nombre || user.usuario || "Usuario"
    },
    usuarios: {
      [me.uid]: profile.usuario || "yo",
      [user.uid]: user.usuario || "usuario"
    },
    actualizado: serverTimestamp()
  }, { merge: true });
}

async function openConversation(id) {
  if (stopMessages) stopMessages();

  const snap = await getDoc(doc(db, "conversaciones", id));
  if (!snap.exists()) {
    showEmpty("La conversación no existe todavía. Selecciona un usuario o crea un grupo.");
    return;
  }

  activeConversation = { id, ...snap.data() };
  renderHeader();
  bindMessages(id);
}

function renderHeader() {
  if (activeConversation.tipo === "grupo") {
    title.textContent = activeConversation.nombre || "Grupo";
    subtitle.textContent = `${activeConversation.miembros?.length || 0} miembros`;
    headerAvatar.textContent = initials(activeConversation.nombre || "Grupo");
  } else {
    const otherUid = activeConversation.miembros?.find((uid) => uid !== me.uid);
    title.textContent = activeConversation.nombres?.[otherUid] || "Chat privado";
    subtitle.textContent = "Chat individual";
    headerAvatar.textContent = initials(title.textContent);
  }
  callLink.href = "#";
  callLink.classList.remove("disabled");
}

function handleCallClick(event) {
  event.preventDefault();
  if (callLink.classList.contains("disabled") || !activeConversation) return;
  if (activeConversation.tipo !== "privado") {
    alert("La videollamada solo funciona en chats privados.");
    return;
  }
  const otherUid = activeConversation.miembros?.find((uid) => uid !== me.uid);
  if (!otherUid) {
    alert("No se pudo detectar al otro participante.");
    return;
  }
  createCallRequest(otherUid).catch((error) => {
    console.error("Error al iniciar llamada:", error);
    alert("No se pudo iniciar la videollamada. Intenta de nuevo más tarde.");
  });
}

async function createCallRequest(calleeUid) {
  const callRef = doc(db, "llamadas", activeConversation.id);
  const callSnap = await getDoc(callRef);
  const previous = callSnap.exists() ? callSnap.data() : null;
  if (previous?.estado === "invitando" || previous?.estado === "activa") {
    alert("Ya hay una llamada en curso en esta conversación.");
    return;
  }

  await setDoc(callRef, {
    conversationId: activeConversation.id,
    caller: me.uid,
    callee: calleeUid,
    callerName: profile.nombre || profile.usuario || "Yo",
    calleeName: activeConversation.nombres?.[calleeUid] || "Usuario",
    estado: "invitando",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  window.location.href = `videollamada.html?c=${activeConversation.id}`;
}

function setupIncomingCallBanner() {
  incomingCallBanner.id = "incomingCall";
  incomingCallBanner.className = "incomingCall hidden";
  if (headerElement?.parentNode) {
    headerElement.parentNode.insertBefore(incomingCallBanner, headerElement.nextSibling);
  }
}

function listenIncomingCalls() {
  const incomingQuery = query(
    collection(db, "llamadas"),
    where("callee", "==", me.uid),
    where("estado", "==", "invitando")
  );

  onSnapshot(incomingQuery, (snapshot) => {
    if (snapshot.empty) {
      hideIncomingCall();
      return;
    }

    const callDoc = snapshot.docs[0];
    showIncomingCall(callDoc.id, callDoc.data());
  }, (error) => {
    console.error("Error al escuchar llamadas entrantes:", error);
  });
}

function showIncomingCall(callId, callData) {
  if (activeIncomingCallId === callId) return;
  activeIncomingCallId = callId;

  incomingCallBanner.innerHTML = `
    <div style="flex:1; min-width:0;">
      <strong style="display:block; color:var(--text);">Llamada entrante</strong>
      <span style="display:block; color:var(--muted); margin-top:4px;">${escapeHtml(callData.callerName || "Alguien") } te está llamando.</span>
    </div>
    <div class="callActions">
      <button class="btn small primary" id="acceptCallBtn">Aceptar</button>
      <button class="btn small danger" id="rejectCallBtn">Rechazar</button>
    </div>
  `;

  incomingCallBanner.classList.remove("hidden");

  const acceptBtn = document.getElementById("acceptCallBtn");
  const rejectBtn = document.getElementById("rejectCallBtn");

  acceptBtn?.addEventListener("click", async () => {
    await setDoc(doc(db, "llamadas", callId), {
      estado: "activa",
      acceptedAt: serverTimestamp(),
      aceptadaPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
    hideIncomingCall();
    window.location.href = `videollamada.html?c=${callId}`;
  });

  rejectBtn?.addEventListener("click", async () => {
    await setDoc(doc(db, "llamadas", callId), {
      estado: "rechazada",
      rechazadoPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
    hideIncomingCall();
  });
}

function hideIncomingCall() {
  activeIncomingCallId = null;
  incomingCallBanner.classList.add("hidden");
  incomingCallBanner.innerHTML = "";
}

function bindMessages(id) {
  const q = query(collection(db, "conversaciones", id, "mensajes"), orderBy("fecha"));
  stopMessages = onSnapshot(q, (snapshot) => {
    chat.innerHTML = "";
    if (snapshot.empty) {
      chat.innerHTML = `<div class="emptyState">Aún no hay mensajes. Escribe el primero.</div>`;
      return;
    }

    snapshot.forEach((item) => {
      const data = item.data();
      const mine = data.uid === me.uid;
      const message = document.createElement("article");
      message.className = `msg ${mine ? "mine" : "theirs"} ${activeConversation?.tipo === "grupo" ? "groupMsg" : ""}`;
      if (!mine) message.style.setProperty("--bubble", messageColor(data.uid || data.usuario));
      message.innerHTML = `
        <div class="metaRow">
          <span class="who">@${escapeHtml(data.usuario || "usuario")}</span>
          <span class="time">${formatDate(data.fecha)}</span>
        </div>
        <div class="text">${escapeHtml(data.texto || "")}</div>
      `;
      chat.appendChild(message);
    });
    chat.scrollTop = chat.scrollHeight;
  }, (error) => {
    console.error("Error al leer mensajes:", error);
    chat.innerHTML = `<div class="emptyState">No se pudieron cargar los mensajes. Revisa las reglas de Firestore.</div>`;
  });
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  if (!activeConversation) {
    alert("Selecciona un contacto o grupo antes de enviar.");
    return;
  }

  sendButton.disabled = true;
  try {
    await addDoc(collection(db, "conversaciones", activeConversation.id, "mensajes"), {
      uid: me.uid,
      usuario: profile.usuario || "usuario",
      nombre: profile.nombre || profile.usuario || "Usuario",
      texto: text,
      fecha: serverTimestamp()
    });
    await setDoc(doc(db, "conversaciones", activeConversation.id), {
      ultimoMensaje: text,
      ultimoMensajeDe: me.uid,
      actualizado: serverTimestamp()
    }, { merge: true });
    input.value = "";
    input.focus();
  } catch (error) {
    console.error("Error al enviar mensaje:", error);
    alert("No se pudo enviar el mensaje. Revisa que hayas iniciado sesión y que Firestore permita escritura.");
  } finally {
    sendButton.disabled = false;
  }
}

function messageColor(seed = "") {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % userColors.length;
  }
  return userColors[Math.abs(hash)];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

sendButton.addEventListener("click", sendMessage);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
