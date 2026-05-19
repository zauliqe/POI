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
import { callManager } from "./call-manager.js";
import { attachmentManager } from "./attachment-manager.js";
import { encryptText, decryptText } from "./crypto-utils.js";


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

// Elementos para adjuntos
const attachBtn = document.getElementById("attachBtn");
const fileInput = document.getElementById("fileInput");
const attachmentPreview = document.getElementById("attachmentPreview");
const attachmentIcon = document.getElementById("attachmentIcon");
const attachmentName = document.getElementById("attachmentName");
const attachmentSize = document.getElementById("attachmentSize");
const clearAttachmentBtn = document.getElementById("clearAttachmentBtn");
const enviarArchivoBtn = document.getElementById("enviarArchivo");
const enviarStickerBtn = document.getElementById("enviarSticker");

// Botón ubicación
const locationBtn = document.getElementById("locationBtn");

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
let stopRecentChats = null;
let activeIncomingCallId = null;
let callSessionId = null;
let callRef = null;
let callStream = null;
let callPeer = null;
let callDocUnsubscribe = null;
let isCaller = false;
let callOverlayOpen = false;
let receivedSignals = new Set();
let peerSignalReady = false; // Indica si SimplePeer ha emitido su propio signal (offer)
let pendingSignals = []; // Cola de signals a procesar cuando peer est listo

callLink.addEventListener("click", handleCallClick);

requireAuth(async (user, userProfile) => {
  me = user;
  profile = userProfile;

  await configurarStickerEspecial();

  bindUsers();
  bindGroups();
  setupIncomingCallBanner();
  listenIncomingCalls();

  const conversationFromUrl = currentConversationId();
  if (conversationFromUrl) {
    await openConversation(conversationFromUrl);
  } else {
    showRecentChats();
  }

  // Auto-colgar si salgo de la pgina o pierdo visibilidad
  window.addEventListener("beforeunload", async () => {
    // Cleanup si cierras la pestaña durante una llamada
    if (callOverlayOpen && callRef) {
      try {
        await setDoc(callRef, {
          estado: "finalizada",
          finalizadaPor: me.uid,
          razon: "tab_closed",
          signals: [],
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error("Error limpiando llamada al cerrar:", error);
      }
      cleanupCallSession();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && callOverlayOpen && callRef) {
      addDebugLog("[|] Pgina oculta, colgando automticamente...");
      endCall().catch(() => {});
    }
  });

  // Limpiar llamadas antiguas al cargar
  await cleanupOldCalls();
});

async function cleanupOldCalls() {
  try {
    const callsRef = collection(db, "llamadas");
    const q = query(callsRef, where("estado", "!=", "finalizada"));
    const snapshot = await getDocs(q);
    const now = Date.now();
    const CALL_TIMEOUT = 10 * 60 * 1000; // 10 minutos

    snapshot.forEach(async (doc) => {
      const callData = doc.data();
      const createdTime = callData.createdAt?.toMillis?.() || 0;
      if (now - createdTime > CALL_TIMEOUT) {
        addDebugLog(`[CLEAN] Limpiando llamada antigua: ${doc.id}`);
        await setDoc(doc.ref, { estado: "finalizada", limpiadoAutomaticamente: true }, { merge: true });
      }
    });
  } catch (error) {
    addDebugLog(` No se pudo limpiar llamadas antiguas: ${error.message}`);
  }
}

function showEmpty(message) {
  activeConversation = null;
  title.textContent = "Chats";
  subtitle.textContent = message;
  renderAvatar(headerAvatar, { nombre: "Chats" });
  callLink.classList.add("disabled");
  chat.innerHTML = `<div class="emptyState">${message}</div>`;
}
async function configurarStickerEspecial() {
  if (!me || !enviarStickerBtn) return;

  try {
    const userSnap = await getDoc(doc(db, "usuarios", me.uid));

    if (!userSnap.exists()) {
      enviarStickerBtn.classList.add("hidden");
      return;
    }

    const userData = userSnap.data();
    const desbloqueadas = userData.recompensasDesbloqueadas || [];

    console.log("Recompensas desbloqueadas:", desbloqueadas);

    if (desbloqueadas.includes("sticker_especial")) {
      enviarStickerBtn.classList.remove("hidden");
    } else {
      enviarStickerBtn.classList.add("hidden");
    }
  } catch (error) {
    console.error("Error revisando sticker especial:", error);
    enviarStickerBtn.classList.add("hidden");
  }
}

function showRecentChats() {
  activeConversation = null;
  title.textContent = "Chats";
  subtitle.textContent = "Chats recientes";
  renderAvatar(headerAvatar, { nombre: "Chats" });
  callLink.classList.add("disabled");

  if (stopMessages) {
    stopMessages();
    stopMessages = null;
  }

  if (stopRecentChats) {
    stopRecentChats();
    stopRecentChats = null;
  }

  const q = query(
    collection(db, "conversaciones"),
    where("miembros", "array-contains", me.uid)
  );

  stopRecentChats = onSnapshot(q, async (snapshot) => {
    if (activeConversation) return;

    const recentChats = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((conv) => conv.ultimoMensaje && String(conv.ultimoMensaje).trim() !== "")
      .sort((a, b) => {
        const aDate = a.actualizado?.toDate ? a.actualizado.toDate().getTime() : 0;
        const bDate = b.actualizado?.toDate ? b.actualizado.toDate().getTime() : 0;
        return bDate - aDate;
      });

    if (!recentChats.length) {
      chat.innerHTML = `
        <div class="recentChatsHome">
          <div class="recentHeader">
            <div>
              <div class="pill">Recientes</div>
              <h2 class="h2" style="margin-top:10px;">Chats recientes</h2>
              <p class="p">Cuando envíes o recibas mensajes, aparecerán aquí.</p>
            </div>
          </div>
          <div class="emptyState">Aún no tienes chats recientes.</div>
        </div>
      `;
      return;
    }

    chat.innerHTML = `
      <div class="recentChatsHome">
        <div class="recentHeader">
          <div>
            <div class="pill">Recientes</div>
            <h2 class="h2" style="margin-top:10px;">Chats recientes</h2>
            <p class="p">Últimas conversaciones con actividad.</p>
          </div>
        </div>
        <div class="recentChatsList"></div>
      </div>
    `;

    const list = chat.querySelector(".recentChatsList");

    for (const conv of recentChats) {
      const info = await getConversationPreview(conv);

      const lastMessage = conv.ultimoMensajeCifrado
        ? await decryptText(conv.ultimoMensaje || "")
        : conv.ultimoMensaje || "Sin mensajes todavía";

      const row = document.createElement("a");
      row.className = "recentChatItem";
      row.href = `dashboard.html?c=${conv.id}`;

      row.innerHTML = `
        <div class="avatar recentAvatar">${avatarContent(info)}</div>
        <div class="recentChatText">
          <div class="recentChatTop">
            <div class="recentChatName">${escapeHtml(info.nombre || "Chat")}</div>
            <div class="recentChatTime">${formatDate(conv.actualizado)}</div>
          </div>
          <div class="recentChatMsg">${escapeHtml(lastMessage)}</div>
        </div>
      `;

      row.addEventListener("click", async (event) => {
        event.preventDefault();
        history.replaceState(null, "", `dashboard.html?c=${conv.id}`);
        await openConversation(conv.id);
      });

      list.appendChild(row);
    }
  }, (error) => {
    console.error("Error al cargar chats recientes:", error);
    chat.innerHTML = `<div class="emptyState">No se pudieron cargar los chats recientes.</div>`;
  });
}

async function getConversationPreview(conv) {
  if (conv.tipo === "grupo") {
    return {
      nombre: conv.nombre || "Grupo",
      usuario: "grupo",
      foto: ""
    };
  }

  const otherUid = conv.miembros?.find((uid) => uid !== me.uid);

  if (otherUid) {
    try {
      const userSnap = await getDoc(doc(db, "usuarios", otherUid));
      if (userSnap.exists()) {
        const user = userSnap.data();
        return {
          nombre: user.nombre || user.usuario || "Chat privado",
          usuario: user.usuario || "usuario",
          foto: user.foto || ""
        };
      }
    } catch (error) {
      console.error("Error al cargar usuario del chat reciente:", error);
    }
  }

  const name =
    conv.nombres?.[otherUid] ||
    conv.usuarios?.[otherUid] ||
    "Chat privado";

  return {
    nombre: name,
    usuario: "usuario",
    foto: ""
  };
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
      contacts.innerHTML = `<div class="mutedBlock">Cuando alguien se registre, aparecer aqu para abrir chat individual.</div>`;
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
      groups.innerHTML = `<a class="item" href="crear-grupo.html"><div class="avatar">+</div><div><div class="name">Crear grupo</div><div class="meta">Todava no tienes grupos</div></div></a>`;
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
    <div class="avatar withStatus">${avatarContent(user)}<span class="statusDot ${online ? "online" : ""}"></span></div>
    <div class="itemText">
      <div class="name">${escapeHtml(user.nombre || user.usuario || "Usuario")}</div>
      <div class="meta">${online ? "En lnea" : "Desconectado"}  @${escapeHtml(user.usuario || "usuario")}</div>
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
    <div class="avatar">${avatarContent(group)}</div>
    <div class="itemText">
      <div class="name">${escapeHtml(group.nombre || "Grupo")}</div>
      <div class="meta">${group.miembros?.length || 0} miembros  ${escapeHtml(group.tipo || "Privado")}</div>
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
  if (stopRecentChats) {
    stopRecentChats();
    stopRecentChats = null;
  }

  if (stopMessages) stopMessages();

  const snap = await getDoc(doc(db, "conversaciones", id));
  if (!snap.exists()) {
    showEmpty("La conversacin no existe todava. Selecciona un usuario o crea un grupo.");
    return;
  }

  activeConversation = { id, ...snap.data() };
  renderHeader();
  bindMessages(id);
}

async function renderHeader() {
  if (activeConversation.tipo === "grupo") {
    title.textContent = activeConversation.nombre || "Grupo";
    subtitle.textContent = `${activeConversation.miembros?.length || 0} miembros`;
    renderAvatar(headerAvatar, { nombre: activeConversation.nombre || "Grupo" });
  } else {
    const otherUid = activeConversation.miembros?.find((uid) => uid !== me.uid);
    title.textContent = activeConversation.nombres?.[otherUid] || "Chat privado";
    subtitle.textContent = "Chat individual";
    if (otherUid) {
      const userSnap = await getDoc(doc(db, "usuarios", otherUid));
      renderAvatar(headerAvatar, userSnap.exists() ? userSnap.data() : { nombre: title.textContent });
    } else {
      renderAvatar(headerAvatar, { nombre: title.textContent });
    }
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
    alert("No se pudo iniciar la videollamada. Intenta de nuevo ms tarde.");
  });
}

async function createCallRequest(calleeUid) {
  // Generar ID nico para cada llamada (no reutilizar el mismo)
  const uniqueCallId = `${activeConversation.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  callRef = doc(db, "llamadas", uniqueCallId);
  
  addDebugLog(` Creando nueva llamada con ID nico: ${uniqueCallId}`);

  // Resetear signals para nueva llamada
  receivedSignals.clear();
  addDebugLog(`[CLEAN] Limpiando signals anteriores...`);

  await setDoc(callRef, {
    conversationId: activeConversation.id,
    caller: me.uid,
    callee: calleeUid,
    callerName: profile.nombre || profile.usuario || "Yo",
    calleeName: activeConversation.nombres?.[calleeUid] || "Usuario",
    estado: "invitando",
    signals: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  callSessionId = uniqueCallId;
  isCaller = true;
  setupCallSession(uniqueCallId, activeConversation.nombres?.[calleeUid] || "Usuario");
}


function setupIncomingCallBanner() {
  incomingCallBanner.id = "incomingCall";
  incomingCallBanner.className = "incomingCall hidden";
  addDebugLog(`Configurando banner de llamada entrante...`);
  document.body.appendChild(incomingCallBanner); // Flotante sobre todo

  // Crear elemento de audio para ringtone si no existe
  if (!window.ringtoneAudio) {
    window.ringtoneAudio = document.createElement('audio');
    window.ringtoneAudio.src = "https://assets.mixkit.co/active_storage/sfx/937/937-preview.mp3"; // Soft notification
    window.ringtoneAudio.loop = true;
    window.ringtoneAudio.preload = "auto";
    window.ringtoneAudio.style.display = "none";
    document.body.appendChild(window.ringtoneAudio);
  }
}

function listenIncomingCalls() {
  addDebugLog(` Iniciando escucha de llamadas entrantes para ${me.uid}...`);
  const incomingQuery = query(
    collection(db, "llamadas"),
    where("callee", "==", me.uid),
    where("estado", "==", "invitando")
  );

  onSnapshot(incomingQuery, (snapshot) => {
    addDebugLog(`[<] Snapshot de llamadas entrantes: ${snapshot.docs.length} documento(s)`);
    if (snapshot.empty) {
      addDebugLog(` Sin llamadas entrantes en este momento`);
      hideIncomingCall();
      return;
    }

    const callDoc = snapshot.docs[0];
    const callData = callDoc.data();
    addDebugLog(` LLAMADA ENTRANTE DETECTADA: de ${callData.callerName}, estado=${callData.estado}`);
    showIncomingCall(callDoc.id, callData);
  }, (error) => {
    addDebugLog(`[X] Error escuchando llamadas entrantes: ${error.message}`);
    console.error("Error al escuchar llamadas entrantes:", error);
  });
}

function setupCallSession(callId, remoteName) {
  if (!callOverlay) return;
  
  // Crear en call manager
  callManager.createCall(callId, {
    isCaller: isCaller,
    remoteName: remoteName
  });
  
  callSessionId = callId;
  callOverlayOpen = true;
  callOverlay.classList.remove("hidden");
  callHeaderTitle.textContent = `Videollamada con ${remoteName}`;
  callHeaderSub.textContent = isCaller ? "Llamando..." : "Aceptando llamada...";
  callStateLabel.textContent = "Conectando...";
  debugPanel.style.display = "block";
  addDebugLog(` Iniciando sesin de llamada. Caller: ${isCaller}`);

  // Forzar reflow para asegurar que el layout se recalcule correctamente
  // (especialmente importante en landscape en tablets)
  if (callOverlay.offsetHeight) {
    void callOverlay.offsetHeight; // Trigger reflow
  }

  callRef = doc(db, "llamadas", callId);
  
  // Pequeño delay para asegurar que el DOM esté completamente actualizado
  setTimeout(() => {
    startLocalMedia()
      .then(async () => {
        callManager.setStreamReady(callSessionId, true);
        createPeerConnection();
        listenCallDocument();
        addDebugLog(`[OK] Sesin de llamada iniciada`);
      })
      .catch((error) => {
        addDebugLog(`[X] Error iniciando medios para la llamada: ${error.message}`);
        callManager.updateCallStatus(callSessionId, "failed");
        callStateLabel.textContent = "No se pudo acceder a la cmara o al micrfono.";
      });
  }, 50);
}

async function startLocalMedia() {
  if (callStream) {
    addDebugLog(` Stream local ya existe`);
    return;
  }
  try {
    addDebugLog(`[CAM] Solicitando getUserMedia...`);
    
    // TIMEOUT: 10 segundos para obtener acceso a cámara/micrófono
    const mediaPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: Permiso de cámara/micrófono denegado o sin respuesta (10s)')), 10000)
    );
    
    callStream = await Promise.race([mediaPromise, timeoutPromise]);
    addDebugLog(`[OK] Stream obtenido: ${callStream?.getTracks().length} tracks`);
    callLocalVideo.srcObject = callStream;
    await callLocalVideo.play().catch(() => {});
    addDebugLog(`[OK] Video local mostrado`);
  } catch (error) {
    addDebugLog(`[X] Error getUserMedia: ${error.message}`);
    
    // Mensajes específicos según el error
    if (error.name === "NotAllowedError" || error.message.includes("Permission denied")) {
      callStateLabel.textContent = "Permiso denegado. Habilita cámara y micrófono en la configuración del navegador.";
    } else if (error.name === "NotFoundError") {
      callStateLabel.textContent = "No hay cámara o micrófono disponible en este dispositivo.";
    } else if (error.name === "NotReadableError") {
      callStateLabel.textContent = "La cámara/micrófono está siendo usada por otra aplicación.";
    } else if (error.message.includes("Timeout")) {
      callStateLabel.textContent = "Timeout: No respondiste a la solicitud de permisos en 10 segundos.";
    } else {
      callStateLabel.textContent = `Error: ${error.message}`;
    }
    
    callManager.updateCallStatus(callSessionId, "failed");
    throw error;
  }
}

let callConnectionTimeout = null; // Variable global para timeout de conexión
let signalRetryMap = new Map(); // Mapa para rastrear reintentos de signals

// Función helper: Procesar signal con reintentos automáticos
async function applySignalWithRetry(signal, maxRetries = 3, initialDelay = 100) {
  let retryCount = 0;
  let delay = initialDelay;
  
  while (retryCount < maxRetries) {
    try {
      if (!callPeer || !callPeer._pc) {
        addDebugLog(`[X] Peer no disponible, abandando reintentos`);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 20));
      callPeer.signal(signal);
      addDebugLog(`[OK] Signal ${signal.type} aplicado exitosamente`);
      return true;
    } catch (error) {
      retryCount++;
      if (retryCount < maxRetries && error.message.includes("wrong state")) {
        addDebugLog(`[RETRY] Reintento ${retryCount}/${maxRetries} para ${signal.type} (delay: ${delay}ms)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = delay * 2; // Backoff exponencial
      } else if (retryCount >= maxRetries) {
        addDebugLog(`[X] Signal ${signal.type} falló tras ${maxRetries} reintentos: ${error.message}`);
        return false;
      } else {
        addDebugLog(`[X] Error no recuperable: ${error.message}`);
        return false;
      }
    }
  }
  return false;
}

function createPeerConnection() {
  if (callPeer || !callStream) {
    addDebugLog(`[X] createPeerConnection: peer ya existe o sin stream`);
    return;
  }
  const SimplePeer = window.SimplePeer;
  if (!SimplePeer) {
    addDebugLog(`[X] SimplePeer NO DISPONIBLE en window`);
    callStateLabel.textContent = "SimplePeer no cargó.";
    return;
  }

  addDebugLog(`[OK] SimplePeer disponible. Initiator: ${isCaller}`);
  
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

  addDebugLog(`[NET] SimplePeer creado. Stream local: ${callStream?.getTracks().length} tracks`);
  
  // TIMEOUT: 30 segundos para establecer conexión
  callConnectionTimeout = setTimeout(() => {
    if (callPeer && callPeer._pc && callPeer._pc.connectionState === "connecting") {
      addDebugLog(`[TIMEOUT] WebRTC connection timeout (30s sin conectar)`);
      callStateLabel.textContent = "Timeout de conexión. Intenta nuevamente.";
      callManager.updateCallStatus(callSessionId, "failed");
      if (callPeer) {
        try { callPeer.destroy(); } catch (e) {}
        callPeer = null;
      }
    }
  }, 30000);
  
  peerSignalReady = false;
  pendingSignals = [];
  
  callManager.setPeerReady(callSessionId, true);
  callManager.updateCallStatus(callSessionId, "connecting");

  callPeer.on("signal", async (signalData) => {
    if (!callRef) return;
    addDebugLog(`[EMIT] Signal emitido por SimplePeer: ${signalData.type}`);
    
    if (!peerSignalReady) {
      peerSignalReady = true;
      addDebugLog(`[READY] SimplePeer ahora listo para recibir signals`);
      
      if (pendingSignals.length > 0 && callPeer && callPeer._pc) {
        const pending = pendingSignals.splice(0);
        for (const sig of pending) {
          try {
            await new Promise(r => setTimeout(r, 15));
            callPeer.signal(sig);
            // Marcar signal como recibido para no re-procesarlo desde snapshot
            receivedSignals.add(JSON.stringify(sig));
          } catch (e) { }
        }
      }
    }
    
    try {
      await setDoc(callRef, {
        signals: arrayUnion({
          from: me.uid,
          signal: signalData,
          timestamp: new Date().toISOString()
        })
      }, { merge: true });
    } catch (error) {
      addDebugLog(`ERROR: ${error.message}`);
    }
  });
  
  callPeer.on("stream", (remoteStream) => {
    addDebugLog(`[CAM] Stream remoto recibido: ${remoteStream?.getTracks().length} tracks`);
    if (remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      callStateLabel.textContent = "Conectado";
      callHeaderSub.textContent = "Videollamada activa";
      addDebugLog(`[OK] Video remoto mostrado`);
    }
  });

  callPeer.on("connect", () => {
    // Limpiar timeout de conexión cuando se establece
    if (callConnectionTimeout) clearTimeout(callConnectionTimeout);
    
    addDebugLog(`[OK] Peer conectado exitosamente`);
    callManager.updateCallStatus(callSessionId, "connected");
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });

  callPeer.on("data", (data) => {
    addDebugLog(`[MSG] Datos recibidos: ${data}`);
  });

  callPeer.on("close", () => {
    addDebugLog(`[|] Peer desconectado`);
    callManager.updateCallStatus(callSessionId, "failed");
    callStateLabel.textContent = "Desconectado - intenta reconectar";
    callPeer = null;
  });

  callPeer.on("error", (err) => {
    addDebugLog(`[X] Error SimplePeer: ${err.message}`);
    callManager.updateCallStatus(callSessionId, "failed");
    callStateLabel.textContent = "Error: " + err.message;
    // Destruir peer si hay error crtico
    if (callPeer) {
      try {
        callPeer.destroy();
      } catch (e) {}
      callPeer = null;
    }
  });
}

function listenCallDocument() {
  if (callDocUnsubscribe) callDocUnsubscribe();
  
  callDocUnsubscribe = onSnapshot(callRef, async (snapshot) => {
    if (!snapshot.exists() || !callPeer) return;
    addDebugLog(`[SNAP] Snapshot recibido. Peer ok: ${!!callPeer}, _pc listo: ${!!callPeer._pc}`);
    
    const data = snapshot.data();
    
    // Estados terminales
    if (data.estado === "rechazada" || data.estado === "finalizada") {
      addDebugLog(`[END] Llamada ${data.estado}`);
      receivedSignals.clear();
      callManager.endCall(callSessionId);
      callStateLabel.textContent = data.estado === "rechazada" ? "Rechazada" : "Finalizada";
      hideCallOverlay();
      cleanupCallSession();
      return;
    }
    
    // ⚠️ Si RTCPeerConnection aún no existe, ENCOLAR signals (no ignorar)
    if (!callPeer._pc) {
      const signals = Array.isArray(data.signals) ? data.signals : [];
      for (const item of signals) {
        if (!item || item.from === me.uid) continue;
        const key = JSON.stringify(item.signal);
        if (!receivedSignals.has(key)) {
          receivedSignals.add(key);  // Marcar para evitar reprocessing
          if (!pendingSignals.find(s => JSON.stringify(s) === JSON.stringify(item.signal))) {
            pendingSignals.push(item.signal);
          }
        }
      }
      return;  // Aguarda siguiente snapshot cuando _pc exista
    }
    
    // Procesar signals cuando _pc YA existe
    const signals = Array.isArray(data.signals) ? data.signals : [];
    const connState = callPeer._pc.connectionState;
    const sigState = callPeer._pc.signalingState;
    addDebugLog(`[PROC] connState=${connState}, sigState=${sigState}, signals=${signals.length}`);
    
    for (const item of signals) {
      if (!item || item.from === me.uid) continue;
      
      const key = JSON.stringify(item.signal);
      if (receivedSignals.has(key)) continue;
      receivedSignals.add(key);
      
      // Saltar offers/answers si ya conectados
      if (connState === "connected" && (item.signal.type === "offer" || item.signal.type === "answer")) {
        continue;
      }
      
      // Si es ANSWER en stable, no procesar - reintentar después
      if (item.signal.type === "answer" && sigState === "stable") {
        receivedSignals.delete(key);
        if (!pendingSignals.find(s => JSON.stringify(s) === JSON.stringify(item.signal))) {
          pendingSignals.push(item.signal);
        }
        continue;
      }
      
      // Procesar signal CON REINTENTOS (siempre, cuando _pc existe)
      const success = await applySignalWithRetry(item.signal, 3, 100);
      if (success) {
        addDebugLog(`[✓] Signal ${item.signal.type} procesado`);
        callManager.recordSignalApplied(callSessionId, item.signal.type);
      } else {
        addDebugLog(`[✗] Signal ${item.signal.type} falló`);
        receivedSignals.delete(key);
        if (!pendingSignals.find(s => JSON.stringify(s) === JSON.stringify(item.signal))) {
          pendingSignals.push(item.signal);
        }
      }
    }
  });
}

async function endCall() {
  addDebugLog(`[CALL] Colgando llamada...`);
  if (callRef) {
    try {
      await setDoc(callRef, {
        estado: "finalizada",
        finalizadaPor: me.uid,
        signals: [], //  LIMPIAR SIGNALS al finalizar
        updatedAt: serverTimestamp()
      }, { merge: true });
      addDebugLog(`[OK] Llamada marcada como finalizada en Firestore`);
    } catch (error) {
      addDebugLog(` Error marcando llamada como finalizada: ${error.message}`);
    }
  }
  receivedSignals.clear();
  addDebugLog(`[CLEAN] Limpiando signals locales...`);
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
  addDebugLog(`[CLEAN] Limpiando sesion de llamada...`);
  if (callConnectionTimeout) clearTimeout(callConnectionTimeout);
  if (callDocUnsubscribe) callDocUnsubscribe();
  callDocUnsubscribe = null;
  receivedSignals.clear();
  peerSignalReady = false;
  pendingSignals = [];
  if (callPeer) {
    callPeer.destroy();
    callPeer = null;
    addDebugLog(`[OK] SimplePeer destruido`);
  }
  if (callStream) {
    callStream.getTracks().forEach((track) => track.stop());
    callStream = null;
    addDebugLog(`[OK] Stream local detenido`);
  }
  callSessionId = null;
  callRef = null;
  addDebugLog(`[OK] Sesion limpiada completamente`);
}

function showIncomingCall(callId, callData) {
  if (activeIncomingCallId === callId) {
    addDebugLog(`Llamada ${callId} ya esta activa, ignorando duplicado`);
    return;
  }
  addDebugLog(`[*] Mostrando notificacion de llamada entrante de ${callData.callerName}`);
  activeIncomingCallId = callId;


  incomingCallBanner.innerHTML = `
    <div style="flex:1; min-width:0;">
      <strong style="display:block; color:var(--text); font-size:1.2em;">Llamada entrante</strong>
      <span style="display:block; color:var(--muted); margin-top:8px; font-size:1em;">${escapeHtml(callData.callerName || "Alguien")} te está llamando.</span>
    </div>
    <div class="callActions" style="margin-top:18px; display:flex; gap:14px; justify-content:center;">
      <button class="btn small primary" id="acceptCallBtn">Aceptar</button>
      <button class="btn small danger" id="rejectCallBtn">Rechazar</button>
    </div>
  `;

  // Reproducir ringtone
  if (window.ringtoneAudio) {
    try { window.ringtoneAudio.currentTime = 0; window.ringtoneAudio.play(); } catch(e) {}
  }

  incomingCallBanner.classList.remove("hidden");
  addDebugLog(`[OK] Banner visible, botones disponibles`);

  const acceptBtn = document.getElementById("acceptCallBtn");
  const rejectBtn = document.getElementById("rejectCallBtn");
  addDebugLog(`Botones encontrados: Accept=${acceptBtn ? "[OK]" : "[X]"}, Reject=${rejectBtn ? "[OK]" : "[X]"}`);

  // AUTO-RECHAZAR DESPUÉS DE 30 SEGUNDOS
  const autoRejectTimeout = setTimeout(async () => {
    if (activeIncomingCallId === callId) {
      addDebugLog(`[TIMEOUT] No respondiste en 30 segundos, rechazando automaticamente...`);
      receivedSignals.clear();
      try {
        await setDoc(doc(db, "llamadas", callId), {
          estado: "rechazada",
          rechazadoPor: me.uid,
          razon: "timeout_no_respuesta",
          signals: [],
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        addDebugLog(`[X] Error auto-rechazando: ${error.message}`);
      }
      hideIncomingCall();
    }
  }, 30000);

  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      clearTimeout(autoRejectTimeout); // Cancelar auto-rechazo
      // Detener ringtone
      if (window.ringtoneAudio) { try { window.ringtoneAudio.pause(); window.ringtoneAudio.currentTime = 0; } catch(e){} }
      addDebugLog(`[OK] Llamada aceptada, actualizando estado...`);
      receivedSignals.clear();
      addDebugLog(`[CLEAN] Limpiando signals anteriores...`);
      try {
        await setDoc(doc(db, "llamadas", callId), {
          estado: "activa",
          acceptedAt: serverTimestamp(),
          aceptadaPor: me.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
        addDebugLog(`[OK] Estado actualizado a 'activa', iniciando sesion...`);
        hideIncomingCall();
        callSessionId = callId;
        isCaller = false;
        setupCallSession(callId, callData.callerName || "Usuario");
      } catch (error) {
        addDebugLog(`[X] Error aceptando llamada: ${error.message}`);
        callStateLabel.textContent = "Error al aceptar la llamada. Intenta nuevamente.";
      }
    };
  }

  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      clearTimeout(autoRejectTimeout); // Cancelar auto-rechazo
      // Detener ringtone
      if (window.ringtoneAudio) { try { window.ringtoneAudio.pause(); window.ringtoneAudio.currentTime = 0; } catch(e){} }
      receivedSignals.clear();
      addDebugLog(`[CLEAN] Llamada rechazada, limpiando signals...`);
      try {
        await setDoc(doc(db, "llamadas", callId), {
          estado: "rechazada",
          rechazadoPor: me.uid,
          signals: [],
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        addDebugLog(`[X] Error rechazando: ${error.message}`);
      }
      hideIncomingCall();
    };
  }
}

function hideIncomingCall() {
  activeIncomingCallId = null;
  incomingCallBanner.classList.add("hidden");
  incomingCallBanner.innerHTML = "";
  // Detener ringtone si está sonando
  if (window.ringtoneAudio) { try { window.ringtoneAudio.pause(); window.ringtoneAudio.currentTime = 0; } catch(e){} }
}

toggleCallMic?.addEventListener("click", () => {
  if (!callStream) return;
  const audioTrack = callStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleCallMic.textContent = audioTrack.enabled ? "Micrfono" : "Micrfono off";
});

toggleCallCamera?.addEventListener("click", () => {
  if (!callStream) return;
  const videoTrack = callStream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.enabled = !videoTrack.enabled;
  toggleCallCamera.textContent = videoTrack.enabled ? "Cmara" : "Cmara off";
});

endCallButton?.addEventListener("click", async () => {
  if (confirm("¿Colgar la videollamada?")) {
    await endCall().catch((error) => {
      console.error("Error al colgar la llamada:", error);
    });
  }
});

closeCallOverlayButton?.addEventListener("click", () => {
  closeOverlay();
});

function bindMessages(id) {
  const q = query(collection(db, "conversaciones", id, "mensajes"), orderBy("fecha"));

  stopMessages = onSnapshot(q, async (snapshot) => {
    chat.innerHTML = "";

    if (snapshot.empty) {
      chat.innerHTML = `<div class="emptyState">Aún no hay mensajes. Escribe el primero.</div>`;
      return;
    }

    for (const item of snapshot.docs) {
      const data = item.data();
      const mine = data.uid === me.uid || data.emisor === me.uid;

      const message = document.createElement("article");
      message.className = `msg ${mine ? "mine" : "theirs"} ${activeConversation?.tipo === "grupo" ? "groupMsg" : ""}`;

      if (!mine) {
        message.style.setProperty("--bubble", messageColor(data.uid || data.usuario || data.emisor));
      }

      const senderAvatar = activeConversation?.tipo === "grupo" && !mine
        ? `<div class="msgAvatar${avatarRewardClass(data)}">${avatarContent(data)}</div>`
        : "";

      if (data.tipo === "sticker") {
        message.innerHTML = `
          ${senderAvatar}
          <div class="metaRow">
            <span class="who">@${escapeHtml(data.usuario || "usuario")}</span>
            <span class="time">${formatDate(data.fecha)}</span>
          </div>
          <div class="stickerMessage">${escapeHtml(data.sticker || "🏆")}</div>
        `;
      } else if (data.tipo === "archivo" && data.archivo) {
        const arch = data.archivo;
        const icon = attachmentManager.getFileIcon?.(arch.tipo) || "📎";
        const isImage = arch.tipo && arch.tipo.startsWith("image/");

        if (isImage) {
          message.innerHTML = `
            ${senderAvatar}
            <div class="metaRow">
              <span class="who">@${escapeHtml(data.usuario || data.emisor || "usuario")}</span>
              <span class="time">${formatDate(data.fecha || data.enviado)}</span>
            </div>
            <div class="imagePreview">
              <a href="${escapeHtml(arch.url)}" target="_blank" download="${escapeHtml(arch.nombre)}">
                <img src="${escapeHtml(arch.url)}" alt="${escapeHtml(arch.nombre)}" title="${escapeHtml(arch.nombre)}">
              </a>
            </div>
          `;
        } else {
          message.innerHTML = `
            ${senderAvatar}
            <div class="metaRow">
              <span class="who">@${escapeHtml(data.usuario || data.emisor || "usuario")}</span>
              <span class="time">${formatDate(data.fecha || data.enviado)}</span>
            </div>
            <div class="attachmentMessage">
              <a href="${escapeHtml(arch.url)}" target="_blank" download="${escapeHtml(arch.nombre)}" class="attachmentLink">
                <span class="attachmentIcon">${icon}</span>
                <div class="attachmentDetails">
                  <div class="attachmentFileName">${escapeHtml(arch.nombre)}</div>
                  <div class="attachmentFileSize">${formatFileSize(arch.tamaño)}</div>
                </div>
              </a>
            </div>
          `;
        }
      } else if (data.tipo === "ubicacion") {
        const ubicacion = data.ubicacion || {};
        const lat = ubicacion.lat || 0;
        const lon = ubicacion.lon || 0;
        const mapUrl = ubicacion.url || `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
        
        message.innerHTML = `
          ${senderAvatar}
          <div class="metaRow">
            <span class="who">@${escapeHtml(data.usuario || "usuario")}</span>
            <span class="time">${formatDate(data.fecha)}</span>
          </div>
          <div class="locationCard">
            <div class="locationIcon">📍</div>
            <div class="locationInfo">
              <div class="locationTitle">Ubicación compartida</div>
              <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" class="locationLink">
                Ver en el mapa →
              </a>
            </div>
          </div>
        `;
      } else {
        let plainText = data.texto || "";

        if (data.cifrado) {
          plainText = await decryptText(data.texto || "");
        }

        message.innerHTML = `
          ${senderAvatar}
          <div class="metaRow">
            <span class="who">@${escapeHtml(data.usuario || "usuario")}</span>
            <span class="time">${formatDate(data.fecha)}</span>
          </div>
          <div class="text">${escapeHtml(plainText)}</div>
        `;
      }

      chat.appendChild(message);
    }

    chat.scrollTop = chat.scrollHeight;
  }, (error) => {
    console.error("Error al leer mensajes:", error);
    chat.innerHTML = `<div class="emptyState">No se pudieron cargar los mensajes. Revisa las reglas de Firestore.</div>`;
  });
}

function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
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
    const encryptedText = await encryptText(text);

    await addDoc(collection(db, "conversaciones", activeConversation.id, "mensajes"), {
      uid: me.uid,
      usuario: profile.usuario || "usuario",
      nombre: profile.nombre || profile.usuario || "Usuario",
      foto: profile.foto || "",
      marcoPerfil: profile.recompensasDesbloqueadas?.includes("marco_perfil") || false,
      texto: encryptedText,
      cifrado: true,
      fecha: serverTimestamp()
    });

    await setDoc(doc(db, "conversaciones", activeConversation.id), {
      ultimoMensaje: encryptedText,
      ultimoMensajeCifrado: true,
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

async function sendStickerEspecial() {
  if (!activeConversation) {
    alert("Selecciona un contacto o grupo antes de enviar.");
    return;
  }

  if (!profile.recompensasDesbloqueadas?.includes("sticker_especial")) {
    alert("Primero debes desbloquear este sticker en Recompensas.");
    return;
  }

  try {
    await addDoc(collection(db, "conversaciones", activeConversation.id, "mensajes"), {
  uid: me.uid,
  usuario: profile.usuario || "usuario",
  nombre: profile.nombre || profile.usuario || "Usuario",
  foto: profile.foto || "",
  marcoPerfil: profile.recompensasDesbloqueadas?.includes("marco_perfil") || false,
  tipo: "sticker",
  sticker: "🏆",
  texto: "Sticker especial",
  fecha: serverTimestamp()
});

    await setDoc(doc(db, "conversaciones", activeConversation.id), {
      ultimoMensaje: "🏆 Sticker especial",
      ultimoMensajeDe: me.uid,
      actualizado: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error("Error al enviar sticker:", error);
    alert("No se pudo enviar el sticker.");
  }
}

// Compartir ubicación con card (no image preview)
async function sendLocation() {
  if (!activeConversation) {
    alert("Selecciona un contacto o grupo antes de compartir ubicación.");
    return;
  }

  if (!navigator.geolocation) {
    alert("Tu navegador no soporta geolocalización.");
    return;
  }

  locationBtn.disabled = true;
  locationBtn.style.opacity = "0.5";

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });
    });

    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const mapUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

    await addDoc(collection(db, "conversaciones", activeConversation.id, "mensajes"), {
      uid: me.uid,
      usuario: profile.usuario || "usuario",
      nombre: profile.nombre || profile.usuario || "Usuario",
      foto: profile.foto || "",
      marcoPerfil: profile.recompensasDesbloqueadas?.includes("marco_perfil") || false,
      tipo: "ubicacion",
      ubicacion: { lat, lon, url: mapUrl },
      fecha: serverTimestamp()
    });

    await setDoc(doc(db, "conversaciones", activeConversation.id), {
      ultimoMensaje: "📍 Ubicación compartida",
      ultimoMensajeDe: me.uid,
      actualizado: serverTimestamp()
    }, { merge: true });

  } catch (error) {
    console.error("Error obteniendo ubicación:", error);
    if (error.code === 1) {
      alert("Permiso denegado para acceder a tu ubicación.");
    } else if (error.code === 2) {
      alert("No se pudo determinar tu ubicación. Intenta de nuevo.");
    } else if (error.code === 3) {
      alert("Tiempo de espera agotado. Revisa tu conexión.");
    } else {
      alert("Error al compartir ubicación: " + error.message);
    }
  } finally {
    locationBtn.disabled = false;
    locationBtn.style.opacity = "1";
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

function avatarContent(data = {}) {
  if (data.foto) return `<img src="${data.foto}" alt="">`;
  return initials(data.nombre || data.usuario || data.name || "U");
}

function avatarRewardClass(data = {}) {
  return data.marcoPerfil ? " rewardFrame" : "";
}

function renderAvatar(element, data = {}) {
  element.innerHTML = avatarContent(data);
}

sendButton.addEventListener("click", sendMessage);
enviarStickerBtn?.addEventListener("click", sendStickerEspecial);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

locationBtn?.addEventListener("click", sendLocation);

// Event listeners para adjuntos
attachBtn?.addEventListener("click", () => {
  fileInput.click();
});

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  
  try {
    const attachment = attachmentManager.selectFile(file);
    showAttachmentPreview(attachment);
    enviarArchivoBtn.classList.remove("hidden");
    sendButton.classList.add("hidden");
  } catch (error) {
    alert(error.message);
    fileInput.value = "";
  }
});

clearAttachmentBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  attachmentManager.clearSelection();
  attachmentPreview.classList.add("hidden");
  fileInput.value = "";
  enviarArchivoBtn.classList.add("hidden");
  sendButton.classList.remove("hidden");
});

enviarArchivoBtn?.addEventListener("click", async () => {
  if (!activeConversation || !attachmentManager.getSelectedFile()) return;
  
  try {
    enviarArchivoBtn.disabled = true;
    enviarArchivoBtn.textContent = "Enviando...";
    
    const attachmentData = await attachmentManager.uploadFile();
    await attachmentManager.saveAttachmentMessage(activeConversation.id, me.uid, {
      usuario: profile.usuario || "usuario",
      nombre: profile.nombre || profile.usuario || "Usuario",
      foto: profile.foto || "",
      ...attachmentData
    });
    
    attachmentManager.clearSelection();
    attachmentPreview.classList.add("hidden");
    fileInput.value = "";
    enviarArchivoBtn.classList.add("hidden");
    enviarArchivoBtn.disabled = false;
    enviarArchivoBtn.textContent = "📤";
    sendButton.classList.remove("hidden");
  } catch (error) {
    console.error("Error enviando archivo:", error);
    alert("Error al enviar archivo: " + error.message);
    enviarArchivoBtn.disabled = false;
    enviarArchivoBtn.textContent = "📤";
  }
});

function showAttachmentPreview(attachment) {
  attachmentIcon.textContent = attachment.icon;
  attachmentName.textContent = attachment.name;
  attachmentSize.textContent = attachment.size;
  attachmentPreview.classList.remove("hidden");
}