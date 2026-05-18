const fs = require('fs');
const path = 'chat.js';

// Leer con encoding UTF-8 explícito
let code = fs.readFileSync(path, { encoding: 'utf8' });

// Restaurar los emojis dañados primero si es necesario, luego hacer cambios
// 1. Cambiar evento close
code = code.replace(
  /callPeer\.on\("close", \(\) => \{\s+addDebugLog\(`.*?Peer cerrado.*?`\);\s+callStateLabel\.textContent = "Llamada finalizada\.";\s+closeOverlay\(\);\s+cleanupCallSession\(\);\s+\}\);/s,
  `callPeer.on("close", () => {
    addDebugLog(\`🔌 CIERRE SIMPLEPEER DETECTADO - NO cerrando overlay\`);
    // NO cerramos el overlay aquí - solo SimplePeer se cerró internamente
    // La pantalla se cierra cuando cuelga el usuario o el otro lado finaliza
  });`
);

// 2. Cambiar evento connect
code = code.replace(
  /callPeer\.on\("connect", \(\) => \{\s+addDebugLog\(`.*?Peer conectado.*?`\);\s+callStateLabel\.textContent = "Conectado";\s+callHeaderSub\.textContent = "Videollamada activa";\s+\}\);/s,
  `callPeer.on("connect", () => {
    addDebugLog(\`✅ PEER CONECTADO - Videollamada establecida\`);
    if (callTimeoutId) {
      clearTimeout(callTimeoutId);
      callTimeoutId = null;
      addDebugLog(\`⏱️ Timeout cancelado - conexión exitosa\`);
    }
    callStateLabel.textContent = "Conectado";
    callHeaderSub.textContent = "Videollamada activa";
  });`
);

// 3. Cambiar evento error
code = code.replace(
  /callPeer\.on\("error", \(err\) => \{\s+addDebugLog\(`.*?Error SimplePeer.*?`\);\s+callStateLabel\.textContent = "Error: " \+ err\.message;\s+\}\);/s,
  `callPeer.on("error", (err) => {
    addDebugLog(\`❌ ERROR SIMPLEPEER: \${err.message}\`);
    callStateLabel.textContent = "Error: " + err.message;
  });`
);

// 4. Cambiar evento stream
code = code.replace(
  /callPeer\.on\("stream", \(remoteStream\) => \{\s+addDebugLog\(`.*?Stream remoto recibido.*?`\);[\s\S]*?addDebugLog\(`.*?Video remoto mostrado.*?`\);[\s\S]*?\}\);/s,
  `callPeer.on("stream", (remoteStream) => {
    addDebugLog(\`🎥 STREAM REMOTO RECIBIDO: \${remoteStream?.getTracks().length} tracks\`);
    if (remoteStream) {
      callRemoteVideo.srcObject = remoteStream;
      callRemoteVideo.play().catch(() => {});
      callStateLabel.textContent = "Conectado";
      callHeaderSub.textContent = "Videollamada activa";
      addDebugLog(\`✅ VIDEO REMOTO MOSTRADO\`);
    }
  });`
);

// Escribir con encoding UTF-8 explícito
fs.writeFileSync(path, code, { encoding: 'utf8' });
console.log('✅ Todos los eventos han sido actualizados correctamente');
