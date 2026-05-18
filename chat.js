import { db } from "./Firebase.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
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

// Debug Panel Setup
const debugLog = document.getElementById("debugLog");
const toggleDebugBtn = document.getElementById("toggleDebug");
const debugPanel = document.getElementById("debugPanel");
let debugMode = false;

if (toggleDebugBtn) {
  toggleDebugBtn.addEventListener("click", () => {
    debugMode = !debugMode;
    debugPanel.style.display = debugMode ? "block" : "none";
    toggleDebugBtn.textContent = debugMode ? "Ocultar Debug" : "Mostrar Debug";
  });
}

function addDebugLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[${timestamp}] ${message}`;
  console.log(fullMessage);
  if (debugLog) {
    debugLog.innerHTML += fullMessage + "\n";
    debugLog.parentElement.scrollTop = debugLog.parentElement.scrollHeight;
  }
}

let me = null;
let profile = null;
let activeConversation = null;
let stopMessages = null;
let activeIncomingCallId = null;
let callSessionId = null;
let callAttemptId = null; // ← NUEVO: ID único para cada intento
let callRef = null;
let callStream = null;
let callPeer = null;
let callDocUnsubscribe = null;
let isCaller = false;
let callOverlayOpen = false;
let receivedSignals = new Set();

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

  // Auto-colgar si salgo de la página o pierdo visibilidad
  window.addEventListener("beforeunload", () => {
    if (callOverlayOpen && callRef) {
      endCall().catch(() => {});
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && callOverlayOpen && callRef) {
      addDebugLog("🔌 Página oculta, colgando automáticamente...");
      endCall().catch(() => {});
    }
  });

  // Limpiar llamadas antiguas al cargar
  await cleanupOldCalls();
});

async function cleanupOldCalls() {
  try {
    addDebugLog(`🧹 Limpiando intentos de llamada antiguos...`);
    const callsRef = collection(db, "llamadas");
    const convSnapshot = await getDocs(callsRef);
    const now = Date.now();
    const CALL_TIMEOUT = 10 * 60 * 1000; // 10 minutos

    for (const convDoc of convSnapshot.docs) {
      const conversationId = convDoc.id;
      const attemptsRef = collection(db, `llamadas/${conversationId}/attempts`);
      const attemptsSnapshot = await getDocs(attemptsRef);

      for (const attemptDoc of attemptsSnapshot.docs) {
        const attemptData = attemptDoc.data();
        const createdTime = attemptData.createdAt?.toMillis?.() || 0;
        
        if (attemptData.estado !== "finalizada" && now - createdTime > CALL_TIMEOUT) {
          addDebugLog(`🧹 Limpiando intento antiguo: ${attemptDoc.id}`);
          await setDoc(attemptDoc.ref, { estado: "finalizada" }, { merge: true });
        }
      }
    }
  } catch (error) {
    addDebugLog(`⚠️ No se pudo limpiar llamadas antiguas: ${error.message}`);
  }
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
  const conversationId = activeConversation.id;
  
  // Generar ID único para este intento de llamada
  callAttemptId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  addDebugLog(`🆔 Nuevo intento de llamada: ${callAttemptId}`);
  
  // Referencia: llamadas/{conversationId}/attempts/{attemptId}
  callRef = doc(db, "llamadas", conversationId, "attempts", callAttemptId);
  
  // LIMPIAR estado anterior
  receivedSignals.clear();
  if (callDocUnsubscribe) {
    callDocUnsubscribe();
    callDocUnsubscribe = null;
  }

  addDebugLog(`🧹 Estado limpiado, preparado para nueva llamada`);

  await setDoc(callRef, {
    conversationId: conversationId,
    caller: me.uid,
    callee: calleeUid,
    callerName: profile.nombre || profile.usuario || "Yo",
    calleeName: activeConversation.nombres?.[calleeUid] || "Usuario",
    estado: "invitando",
    signals: [], // ← INICIALIZAR VACÍO
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  callSessionId = callAttemptId;
  isCaller = true;
  setupCallSession(callAttemptId, activeConversation.nombres?.[calleeUid] || "Usuario");
}


function setupIncomingCallBanner() {
  incomingCallBanner.id = "incomingCall";
  incomingCallBanner.className = "incomingCall hidden";
  addDebugLog(`🔔 Configurando banner de llamada entrante...`);
  if (headerElement?.parentNode) {
    headerElement.parentNode.insertBefore(incomingCallBanner, headerElement.nextSibling);
    addDebugLog(`✅ Banner insertado en el DOM`);
  } else {
    addDebugLog(`❌ headerElement o su parentNode no existen`);
  }
}

function listenIncomingCalls() {
  addDebugLog(`🔊 Iniciando escucha de llamadas entrantes para ${me.uid}...`);
  
  // Escuchar TODAS las colecciones de intentos de llamada
  const conversationsRef = collection(db, "llamadas");
  const unsubscribers = [];

  // Esto requiere una consulta más compleja. Por ahora, escuchamos la colección de llamadas raíz
  // y luego consultamos sus subcollections
  onSnapshot(conversationsRef, async (snapshot) => {
    for (const convDoc of snapshot.docs) {
      const conversationId = convDoc.id;
      
      // Escuchar intentos de esta conversación
      const attemptsRef = collection(db, `llamadas/${conversationId}/attempts`);
      const attemptQuery = query(
        attemptsRef,
        where("callee", "==", me.uid),
        where("estado", "==", "invitando")
      );

      onSnapshot(attemptQuery, (attemptSnapshot) => {
        if (attemptSnapshot.empty) {
          addDebugLog(`⚠️ Sin intentos de llamada entrante en ${conversationId}`);
          return;
        }

        const attemptDoc = attemptSnapshot.docs[0];
        const attemptData = attemptDoc.data();
        addDebugLog(`🔔 LLAMADA ENTRANTE DETECTADA: de ${attemptData.callerName}, estado=${attemptData.estado}`);
        showIncomingCall(attemptDoc.id, attemptData, conversationId);
      });
    }
  }, (error) => {
    addDebugLog(`❌ Error escuchando conversaciones: ${error.message}`);
  });
}

function setupCallSession(callId, remoteName) {
  if (!callOverlay) return;
  callSessionId = callId;
  callOverlayOpen = true;
  callOverlay.classList.remove("hidden");
  callHeaderTitle.textContent = `Videollamada con ${remoteName}`;
  callHeaderSub.textContent = isCaller ? "Llamando..." : "Aceptando llamada...";
  callStateLabel.textContent = "Conectando...";
  debugPanel.style.display = "block";
  addDebugLog(`🚀 Iniciando sesión de llamada. Caller: ${isCaller}`);

  // callRef ya debe estar asignado desde createCallRequest o showIncomingCall
  startLocalMedia()
    .then(async () => {
      createPeerConnection();
      listenCallDocument();
      addDebugLog(`✅ Sesión de llamada iniciada`);
    })
    .catch((error) => {
      addDebugLog(`❌ Error iniciando medios para la llamada: ${error.message}`);
      callStateLabel.textContent = "No se pudo acceder a la cámara o al micrófono.";
    });
}

async function startLocalMedia() {
  if (callStream) {
    addDebugLog(`⚠️ Stream local ya existe`);
    return;
  }
  try {
    addDebugLog(`🎥 Solicitando getUserMedia...`);
    callStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addDebugLog(`✅ Stream obtenido: ${callStream?.getTracks().length} tracks`);
    callLocalVideo.srcObject = callStream;
    await callLocalVideo.play().catch(() => {});
    addDebugLog(`✅ Video local mostrado`);
  } catch (error) {
    addDebugLog(`❌ Error getUserMedia: ${error.message}`);
    throw error;
  }
}

function createPeerConnection() {
  if (callPeer || !callStream) {
    addDebugLog(`❌ createPeerConnection: peer ya existe o sin stream`);
    return;
  }
  const SimplePeer = window.SimplePeer;
  if (!SimplePeer) {
    addDebugLog(`❌ SimplePeer NO DISPONIBLE en window`);
    callStateLabel.textContent = "SimplePeer no cargó.";
    return;
  }

  addDebugLog(`✅ SimplePeer disponible. Initiator: ${isCaller}`);
  
  callPeer = new SimplePeer({
    initiator: isCaller,
    trickle: true,
    stream: callStream,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        {
          urls: ["turn:relay.backups.cz:80", "turn:relay.backups.cz:443"],
          username: "homeo",
          credential: "homeo"
        }
      ]
    }
  });

  addDebugLog(`📡 SimplePeer creado. Stream local: ${callStream?.getTracks().length} tracks`);

  callPeer.on("signal", async (signalData) => {
    if (!callRef) return;
    addDebugLog(`📤 Signal emitido: ${signalData.type}`);
    try {
      await setDoc(callRef, {
        signals: arrayUnion({
          from: me.uid,
          signal: signalData,
          timestamp: new Date().toISOString()
        })
      }, { merge: true });
      addDebugLog(`✅ Signal guardado en Firestore`);
    } catch (error) {
      addDebugLog(`❌ Error guardando signal: ${error.message}`);
    }
  });

  callPeer.on("stream", (remoteStream) => {
    addDebugLog(`🎥 Stream remoto recibido: ${remoteStream?.getTracks().length} tracks`);
    if (remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      callStateLabel.textContent = "Conectado";
      callHeaderSub.textContent = "Videollamada activa";
      addDebugLog(`✅ Video remoto mostrado`);
    }
  });

  callPeer.on("connect", () => {
    addDebugLog(`✅ Peer conectado exitosamente`);
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });

  callPeer.on("data", (data) => {
    addDebugLog(`📨 Datos recibidos: ${data}`);
  });

  callPeer.on("close", () => {
    addDebugLog(`🔌 Peer desconectado, pero NO cierra overlay automáticamente`);
    callStateLabel.textContent = "Desconectado - intenta reconectar";
  });

  callPeer.on("error", (err) => {
    addDebugLog(`❌ Error SimplePeer: ${err.message}`);
    callStateLabel.textContent = "Error: " + err.message;
  });
}

function listenCallDocument() {
  if (callDocUnsubscribe) callDocUnsubscribe();
  addDebugLog(`👂 Escuchando documento de llamada: ${callAttemptId}`);
  
  callDocUnsubscribe = onSnapshot(callRef, async (snapshot) => {
    if (!snapshot.exists()) {
      addDebugLog(`⚠️ Documento de intento no existe`);
      return;
    }
    const data = snapshot.data();
    addDebugLog(`📄 Estado llamada: ${data.estado}, signals: ${data.signals?.length || 0}, peer: ${callPeer ? "✅" : "❌"}`);

    if (data.estado === "rechazada") {
      addDebugLog(`🚫 Llamada rechazada`);
      receivedSignals.clear();
      addDebugLog(`🧹 Limpiando signals...`);
      callStateLabel.textContent = "La llamada fue rechazada.";
      hideCallOverlay();
      cleanupCallSession();
      return;
    }

    if (data.estado === "finalizada") {
      addDebugLog(`🏁 Llamada finalizada`);
      receivedSignals.clear();
      addDebugLog(`🧹 Limpiando signals...`);
      callStateLabel.textContent = "La llamada terminó.";
      hideCallOverlay();
      cleanupCallSession();
      return;
    }

    // Procesar signals solo si callPeer existe
    const signals = Array.isArray(data.signals) ? data.signals : [];
    let newSignals = 0;
    
    if (callPeer && signals.length > 0) {
      for (const signalItem of signals) {
        if (!signalItem || signalItem.from === me.uid) continue;
        const signalKey = JSON.stringify(signalItem.signal);
        if (receivedSignals.has(signalKey)) continue;
        receivedSignals.add(signalKey);
        newSignals++;
        addDebugLog(`📥 Signal remoto recibido: ${signalItem.signal.type}`);
        try {
          callPeer.signal(signalItem.signal);
          addDebugLog(`✅ Signal aplicado a peer`);
        } catch (error) {
          addDebugLog(`❌ Error aplicando signal: ${error.message}`);
        }
      }
      if (newSignals > 0) {
        addDebugLog(`📦 ${newSignals} signals nuevos procesados`);
      }
    } else if (!callPeer && signals.length > 0) {
      addDebugLog(`⏳ callPeer aún no existe, esperando...`);
    }

    if (!isCaller && data.estado === "activa") {
      addDebugLog(`📞 Callee: llamada activa`);
      if (!callPeer) {
        addDebugLog(`⏳ callPeer no listo aún para callee`);
      }
      callStateLabel.textContent = "Aceptando llamada...";
    }

    if (isCaller && data.estado === "activa") {
      addDebugLog(`📞 Caller: llamada activa`);
      callStateLabel.textContent = "Conectando...";
    }
  }, (error) => {
    addDebugLog(`❌ Error escuchando documento: ${error.message}`);
  });
}

async function endCall() {
  addDebugLog(`📞 Colgando llamada...`);
  if (callDocUnsubscribe) {
    callDocUnsubscribe();
    callDocUnsubscribe = null;
  }
  
  if (callRef) {
    try {
      await setDoc(callRef, {
        estado: "finalizada",
        finalizadaPor: me.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      addDebugLog(`✅ Llamada marcada como finalizada en Firestore`);
    } catch (error) {
      addDebugLog(`⚠️ Error marcando llamada como finalizada: ${error.message}`);
    }
  }
  receivedSignals.clear();
  addDebugLog(`🧹 Limpiando signals locales...`);
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
  addDebugLog(`🧹 Limpiando sesión de llamada: ${callAttemptId}`);
  
  if (callDocUnsubscribe) {
    callDocUnsubscribe();
    callDocUnsubscribe = null;
  }
  
  receivedSignals.clear();
  
  if (callPeer) {
    callPeer.destroy();
    callPeer = null;
    addDebugLog(`✅ SimplePeer destruido`);
  }
  
  if (callStream) {
    callStream.getTracks().forEach((track) => track.stop());
    callStream = null;
    addDebugLog(`✅ Stream local detenido`);
  }
  
  callSessionId = null;
  callAttemptId = null;
  callRef = null;
  addDebugLog(`✅ Sesión limpiada completamente`);
}

function showIncomingCall(attemptId, callData, conversationId) {
  if (activeIncomingCallId === attemptId) {
    addDebugLog(`⏭️ Intento ${attemptId} ya está activo, ignorando duplicado`);
    return;
  }
  addDebugLog(`🎯 Mostrando notificación de llamada entrante de ${callData.callerName}`);
  activeIncomingCallId = attemptId;

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
  addDebugLog(`✅ Banner visible, botones disponibles`);

  const acceptBtn = document.getElementById("acceptCallBtn");
  const rejectBtn = document.getElementById("rejectCallBtn");
  addDebugLog(`🔘 Botones encontrados: Accept=${acceptBtn ? "✅" : "❌"}, Reject=${rejectBtn ? "✅" : "❌"}`);

  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      addDebugLog(`✅ Llamada aceptada, actualizando estado...`);
      // RESETEAR signals para evitar conflictos de la llamada anterior
      receivedSignals.clear();
      callAttemptId = attemptId;
      addDebugLog(`🧹 Limpiando signals anteriores...`);
      
      // Referencia a este intento específico
      callRef = doc(db, "llamadas", conversationId, "attempts", attemptId);
      
      await setDoc(callRef, {
        estado: "activa",
        acceptedAt: serverTimestamp(),
        aceptadaPor: me.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      addDebugLog(`✅ Estado actualizado a 'activa', iniciando sesión...`);
      hideIncomingCall();
      callSessionId = attemptId;
      isCaller = false;
      setupCallSession(attemptId, callData.callerName || "Usuario");
    };
  }

  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      receivedSignals.clear();
      callAttemptId = attemptId;
      addDebugLog(`🧹 Llamada rechazada, limpiando signals...`);
      
      callRef = doc(db, "llamadas", conversationId, "attempts", attemptId);
      
      await setDoc(callRef, {
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
  if (!callStream) return;
  const audioTrack = callStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleCallMic.textContent = audioTrack.enabled ? "Micrófono" : "Micrófono off";
});

toggleCallCamera?.addEventListener("click", () => {
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
