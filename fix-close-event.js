const fs = require('fs');
const path = 'chat.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Cambiar evento close - NO cerrar el overlay
const closeEventOld = `  callPeer.on("close", () => {
    addDebugLog(\`🔌 Peer cerrado\`);
    callStateLabel.textContent = "Llamada finalizada.";
    closeOverlay();
    cleanupCallSession();
  });`;

const closeEventNew = `  callPeer.on("close", () => {
    addDebugLog(\`🔌 CIERRE SIMPLEPEER DETECTADO - NO cerrando overlay\`);
    // NO cerramos el overlay aquí - solo SimplePeer se cerró internamente
    // La pantalla se cierra cuando cuelga el usuario o el otro lado finaliza
  });`;

code = code.replace(closeEventOld, closeEventNew);

// 2. Cambiar evento connect - cancelar timeout
const connectEventOld = `  callPeer.on("connect", () => {
    addDebugLog(\`✅ Peer conectado exitosamente\`);
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });`;

const connectEventNew = `  callPeer.on("connect", () => {
    addDebugLog(\`✅ PEER CONECTADO - Videollamada establecida\`);
    if (callTimeoutId) {
      clearTimeout(callTimeoutId);
      callTimeoutId = null;
      addDebugLog(\`⏱️ Timeout cancelado - conexión exitosa\`);
    }
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });`;

code = code.replace(connectEventOld, connectEventNew);

// 3. Cambiar evento stream
const streamEventOld = `  callPeer.on("stream", (remoteStream) => {
    addDebugLog(\`🎥 Stream remoto recibido: \${remoteStream?.getTracks().length} tracks\`);
    if (remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      callStateLabel.textContent = "Conectado";
      callHeaderSub.textContent = "Videollamada activa";
      addDebugLog(\`✅ Video remoto mostrado\`);
    }
  });`;

const streamEventNew = `  callPeer.on("stream", (remoteStream) => {
    addDebugLog(\`🎥 STREAM REMOTO RECIBIDO: \${remoteStream?.getTracks().length} tracks\`);
    if (remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      callStateLabel.textContent = "Conectado";
      callHeaderSub.textContent = "Videollamada activa";
      addDebugLog(\`✅ VIDEO REMOTO MOSTRADO\`);
    }
  });`;

code = code.replace(streamEventOld, streamEventNew);

// 4. Cambiar evento error
const errorEventOld = `  callPeer.on("error", (err) => {
    addDebugLog(\`❌ Error SimplePeer: \${err.message}\`);
    callStateLabel.textContent = "Error: " + err.message;
  });`;

const errorEventNew = `  callPeer.on("error", (err) => {
    addDebugLog(\`❌ ERROR SIMPLEPEER: \${err.message}\`);
    callStateLabel.textContent = "Error: " + err.message;
  });`;

code = code.replace(errorEventOld, errorEventNew);

fs.writeFileSync(path, code);
console.log('✅ Todos los eventos SimplePeer han sido actualizados correctamente');
