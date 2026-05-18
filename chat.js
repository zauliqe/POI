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
const callOverlay = document.getElementById("callOverlay");
const callHeaderTitle = document.getElementById("callHeaderTitle");
const callHeaderSub = document.getElementById("callHeaderSub");
const callLocalVideo = document.getElementById("callLocalVideo");
const callRemoteVideo = document.getElementById("callRemoteVideo");
const toggleCallCamera = document.getElementById("toggleCallCamera");
const toggleCallMic = document.getElementById("toggleCallMic");
const endCallButton = document.getElementById("endCall");
const closeCallOverlayButton = document.getElementById("closeCallOverlay");
const callStateLabel = document.getElementById("callStateLabel");
const headerElement = document.querySelector(".topbar");
const incomingCallBanner = document.createElement("div");

const userColors = ["#256f5c", "#355f9d", "#7a4d92", "#8a6333", "#8a3f5d", "#4f6f36", "#6b5a2f"];

let me = null;
let profile = null;
let activeConversation = null;
let stopMessages = null;
let activeIncomingCallId = null;
let callSessionId = null;
let callRef = null;
let callStream = null;
let callJitsiApi = null;
let callRoomName = null;
let callDocUnsubscribe = null;
let isCaller = false;
let callOverlayOpen = false;
let isAudioMuted = false;
let isVideoMuted = false;

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
  callLink.href = "javascript:void(0)";
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
  const callId = activeConversation.id;
  callRef = doc(db, "llamadas", callId);
  const callSnap = await getDoc(callRef);
  const previous = callSnap.exists() ? callSnap.data() : null;
  if (previous?.estado === "invitando" || previous?.estado === "activa") {
    alert("Ya hay una llamada en curso en esta conversación.");
    return;
  }

  const roomName = `CamOllin-${callId}-${Date.now()}`;

  await setDoc(callRef, {
    conversationId: callId,
    caller: me.uid,
    callee: calleeUid,
    callerName: profile.nombre || profile.usuario || "Yo",
    calleeName: activeConversation.nombres?.[calleeUid] || "Usuario",
    roomName,
    estado: "invitando",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  callSessionId = callId;
  callRoomName = roomName;
  isCaller = true;
  setupCallSession(callId, activeConversation.nombres?.[calleeUid] || "Usuario", roomName);
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

function setupCallSession(callId, remoteName, roomName) {
  if (!callOverlay) return;
  callSessionId = callId;
  callRoomName = roomName || callRoomName || callId;
  callOverlayOpen = true;
  callOverlay.classList.remove("hidden");
  callHeaderTitle.textContent = `Videollamada con ${remoteName}`;
  callHeaderSub.textContent = isCaller ? "Llamando..." : "Uniendo llamada...";
  callStateLabel.textContent = "Conectando...";

  callRef = doc(db, "llamadas", callId);
  document.querySelector(".callGrid")?.classList.add("hidden");
  const jitsiContainer = document.getElementById("jitsiContainer");
  if (jitsiContainer) {
    jitsiContainer.style.display = "block";
  }

  createJitsiMeeting(callRoomName);
  listenCallDocument();
}

async function startLocalMedia() {
  if (callStream) return;
  callStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  callLocalVideo.srcObject = callStream;
  await callLocalVideo.play().catch(() => {});
}

function createPeerConnection() {
  // El flujo de WebRTC nativo ya no se usa: ahora la videollamada se hace con Jitsi embebido.
  return;
}

function createJitsiMeeting(roomName) {
  if (!window.JitsiMeetExternalAPI) {
    console.error("Jitsi External API no está disponible.");
    callStateLabel.textContent = "No se pudo iniciar la videollamada.";
    return;
  }

  const jitsiContainer = document.getElementById("jitsiContainer");
  if (!jitsiContainer) return;

  jitsiContainer.innerHTML = "";

  const domain = "meet.jit.si";
  const options = {
    roomName,
    parentNode: jitsiContainer,
    width: "100%",
    height: "100%",
    configOverwrite: {
      startWithAudioMuted: false,
      startWithVideoMuted: false
    },
    interfaceConfigOverwrite: {
      TOOLBAR_BUTTONS: [
        "microphone", "camera", "hangup", "fullscreen", "chat", "tileview"
      ]
    }
  };

  callJitsiApi = new window.JitsiMeetExternalAPI(domain, options);

  callJitsiApi.addEventListener("videoConferenceJoined", () => {
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });

  callJitsiApi.addEventListener("readyToClose", () => {
    endCall().catch((error) => {
      console.error("Error al terminar la llamada:", error);
    });
  });
}

function listenCallDocument() {
  if (callDocUnsubscribe) callDocUnsubscribe();
  callDocUnsubscribe = onSnapshot(callRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    if (data.estado === "rechazada") {
      callStateLabel.textContent = "La llamada fue rechazada.";
      hideCallOverlay();
      cleanupCallSession();
      return;
    }

    if (data.estado === "finalizada") {
      callStateLabel.textContent = "La llamada terminó.";
      hideCallOverlay();
      cleanupCallSession();
      return;
    }

    if (!isCaller && data.estado === "activa") {
      callStateLabel.textContent = "Uniendo llamada...";
    }

    if (isCaller && data.estado === "activa") {
      callStateLabel.textContent = "Conectando...";
    }
  });
}

async function endCall() {
  if (callJitsiApi) {
    try {
      callJitsiApi.executeCommand("hangup");
    } catch (error) {
      console.error("Error al colgar Jitsi:", error);
    }
  }
  if (callRef) {
    await setDoc(callRef, {
      estado: "finalizada",
      finalizadaPor: me.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  closeOverlay();
  cleanupCallSession();
}

function hideCallOverlay() {
  closeOverlay();
}

function closeOverlay() {
  if (!callOverlay) return;
  callOverlay.classList.add("hidden");
  callOverlayOpen = false;
}

function cleanupCallSession() {
  if (callDocUnsubscribe) callDocUnsubscribe();
  callDocUnsubscribe = null;
  if (callJitsiApi) {
    try {
      callJitsiApi.dispose();
    } catch (error) {
      console.error("Error al limpiar Jitsi:", error);
    }
    callJitsiApi = null;
  }
  const jitsiContainer = document.getElementById("jitsiContainer");
  if (jitsiContainer) {
    jitsiContainer.innerHTML = "";
  }
  document.querySelector(".callGrid")?.classList.remove("hidden");
  if (callStream) {
    callStream.getTracks().forEach((track) => track.stop());
    callStream = null;
  }
  callSessionId = null;
  callRef = null;
  callRoomName = null;
  isAudioMuted = false;
  isVideoMuted = false;
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

  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      await setDoc(doc(db, "llamadas", callId), {
        estado: "activa",
        acceptedAt: serverTimestamp(),
        aceptadaPor: me.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      hideIncomingCall();
      callSessionId = callId;
      isCaller = false;
      callRoomName = callData.roomName || callId;
      setupCallSession(callId, callData.callerName || "Usuario", callRoomName);
    };
  }

  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      await setDoc(doc(db, "llamadas", callId), {
        estado: "rechazada",
        rechazadoPor: me.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      hideIncomingCall();
    };
  }
}

function hideIncomingCall() {
  activeIncomingCallId = null;
  incomingCallBanner.classList.add("hidden");
  incomingCallBanner.innerHTML = "";
}

toggleCallMic?.addEventListener("click", () => {
  if (callJitsiApi) {
    callJitsiApi.executeCommand("toggleAudio");
    isAudioMuted = !isAudioMuted;
    toggleCallMic.textContent = isAudioMuted ? "Micrófono off" : "Micrófono";
    return;
  }
  if (!callStream) return;
  const audioTrack = callStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleCallMic.textContent = audioTrack.enabled ? "Micrófono" : "Micrófono off";
});

toggleCallCamera?.addEventListener("click", () => {
  if (callJitsiApi) {
    callJitsiApi.executeCommand("toggleVideo");
    isVideoMuted = !isVideoMuted;
    toggleCallCamera.textContent = isVideoMuted ? "Cámara off" : "Cámara";
    return;
  }
  if (!callStream) return;
  const videoTrack = callStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  toggleCallCamera.textContent = videoTrack.enabled ? "Cámara" : "Cámara off";
});

endCallButton?.addEventListener("click", async () => {
  await endCall().catch((error) => {
    console.error("Error al colgar la llamada:", error);
  });
});

closeCallOverlayButton?.addEventListener("click", () => {
  closeOverlay();
});

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
