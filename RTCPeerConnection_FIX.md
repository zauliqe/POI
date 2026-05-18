# Solución: RTCPeerConnection Error "Called in wrong state: stable"

## 📍 El Problema Exacto

### Error Original

```
❌ Error SimplePeer: Failed to execute 'setRemoteDescription' on 'RTCPeerConnection':
   Failed to set remote answer sdp: Called in wrong state: stable
```

### Localización en Código

**Archivo:** `chat.js`
**Función:** `listenCallDocument()`
**Línea problemática:** `callPeer.signal(signalItem.signal)`

### ¿Por qué Ocurre?

WebRTC (RTCPeerConnection) tiene una **máquina de estados muy estricta**:

```
ESTADO: stable (inicial)
         ↓
ACCIÓN: Enviar OFFER
         ↓
ESTADO: have-local-offer
         ↓
ACCIÓN: Recibir ANSWER
         ↓
ESTADO: stable (conexión activa)
```

**El error ocurre cuando:**

- Se intenta procesar un ANSWER mientras el peer está en estado `stable`
- Esto significa: no hemos enviado un OFFER todavía, pero recibimos un ANSWER
- SimplePeer internamente no ha terminado su inicialización

### Escenario de Fallo (Pre-Corrección)

```
Tiempo: t0
┌─ CALLER                          ┌─ CALLEE
│                                  │
├─ createPeerConnection()          ├─ (esperando)
│  createInstance                  │
│  (SimplePeer starts up)           │
│                                  │
├─ (SimplePeer internal state:    ├─ listenCallDocument()
│   generating offer...)           │  (FIRESTORE: signals=[caller_offer])
│                                  │
├─ callPeer.emit('signal', offer)  ├─ callPeer.signal(offer) ✅
│  → sent to Firestore             │  (CALLEE now sending answer)
│                                  │
├─ listenCallDocument()            ├─ callPeer.emit('signal', answer)
│  (FIRESTORE: signals=[..., callee_answer])  │  → sent to Firestore
│                                  │
├─ callPeer.signal(answer) ❌      └─
│  ERROR: state is still "stable"
│  (didn't see its own offer yet)
└─
```

**Raíz del Problema:** `listenCallDocument()` procesa signals ANTES de que SimplePeer haya emitido su propio signal (offer). SimplePeer aún está internamente en estado "stable" aunque esté generando el offer.

---

## ✅ La Solución

### Componente 1: Flag de Readiness

**En variables globales:**

```javascript
let peerSignalReady = false; // SimplePeer ha emitido su propio signal
let pendingSignals = []; // Cola de signals mientras espera
```

### Componente 2: Marcar Readiness en SimplePeer Signal Event

**En `createPeerConnection()`, evento "signal":**

```javascript
callPeer.on("signal", async (signalData) => {
  // CRÍTICO: Marcar que SimplePeer está listo para recibir signals
  if (!peerSignalReady) {
    peerSignalReady = true;
    addDebugLog(`🎯 SimplePeer listo para recibir signals remotos`);

    // Procesar signals pendientes
    if (pendingSignals.length > 0) {
      for (const sig of pendingSignals.splice(0)) {
        callPeer.signal(sig);
      }
    }
  }

  // ... resto del código
});
```

**¿Por qué funciona?**

- Cuando SimplePeer emite su primer signal (offer para initiator), ya ha:
  - Inicializado RTCPeerConnection
  - Pasado la máquina de estados interna
  - Está listo para recibir signals remotos

### Componente 3: Encolar Signals Pendientes

**En `listenCallDocument()`, procesamiento de signals:**

```javascript
if (!peerSignalReady) {
  addDebugLog(`⏳ SimplePeer aún no listo, encolando signal`);
  pendingSignals.push(signalItem.signal);
  continue;  // NO procesar todavía
}

// Si llegamos aquí, SimplePeer está listo
try {
  await new Promise(resolve => setTimeout(resolve, 10)); // Pequeño delay
  callPeer.signal(signalItem.signal);
  addDebugLog(`✅ Signal aplicado a peer`);
} catch (error) {
  // ... manejo de errores
}
```

### Componente 4: Resetear en Limpieza

**En `cleanupCallSession()`:**

```javascript
peerSignalReady = false;
pendingSignals = [];
```

---

## 🔄 Flujo Post-Corrección

```
Tiempo: t0
┌─ CALLER                          ┌─ CALLEE
│                                  │
├─ createPeerConnection()          ├─ (esperando)
│  peerSignalReady = false         │
│  pendingSignals = []             │
│                                  │
├─ (SimplePeer generando offer)   ├─ listenCallDocument()
│                                  │  signal = caller_offer
├─ callPeer.emit('signal')         │  ✅ peerSignalReady = true
│  → peerSignalReady = TRUE        │  ✅ procesar signals pendientes
│  → procesar pendingSignals[]     │  callPeer.signal(offer) ✅
│  → send offer to Firestore       │
│                                  │
├─ listenCallDocument()            ├─ (respondiendo con answer)
│  signal = callee_answer          │
│  ✅ peerSignalReady = true       │
│  ✅ callPeer.signal(answer) ✅   │
│                                  └─
└─
```

**Resultado:** Signals nunca se aplican en estado `stable` porque esperamos a que SimplePeer esté listo.

---

## 🧪 Validación

Para ver esto funcionando:

1. **Abre el Debug Panel** en la videollamada
2. **Primera llamada:**
   ```
   🎯 SimplePeer listo para recibir signals remotos (offer emitido)
   📥 Signal remoto recibido: answer
   ✅ Signal aplicado a peer
   ```
3. **Segunda llamada (sin recargar):**
   - Verás el mismo flujo sin errores
   - ID único diferente
   - Ningún error "Called in wrong state"

---

## 📊 Cambios Detallados

### Variables Nuevas

```javascript
let peerSignalReady = false; // Indica readiness de SimplePeer
let pendingSignals = []; // Cola de signals pendientes
```

### Función: `createPeerConnection()`

- ✅ Resetea `peerSignalReady = false`
- ✅ Resetea `pendingSignals = []`
- ✅ En evento "signal": establece `peerSignalReady = true`
- ✅ Procesa cola de `pendingSignals` cuando sea ready

### Función: `listenCallDocument()`

- ✅ Valida `peerSignalReady` antes de procesar
- ✅ Encola signals si no está ready
- ✅ Agrega delay de 10ms entre signals
- ✅ Detecta "wrong state" errors y marca peer como failed

### Función: `cleanupCallSession()`

- ✅ Resetea `peerSignalReady = false`
- ✅ Limpia `pendingSignals = []`

---

## 🎯 Causa Raíz (Resumen)

| Problema                                        | Causa                                         | Solución                                        |
| ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Signal llega antes de que SimplePeer esté listo | SimplePeer aún está en estado "stable"        | Esperar a que SimplePeer emita su propio signal |
| Peer en estado incorrecto                       | No sincronizado con máquina de estados WebRTC | Flag `peerSignalReady` sincroniza esto          |
| No hay forma de saber si peer está listo        | Event "signal" es indicador                   | Usar primer "signal" como trigger               |

---

## 🚨 Errores Prevenidos

Con esta solución:

- ✅ "Called in wrong state: stable" → **PREVENIDO**
- ✅ "Failed to set remote answer sdp" → **PREVENIDO**
- ✅ "cannot signal after peer is destroyed" → **MITIGADO** (con health checks)
- ✅ Segunda llamada fallando → **CORREGIDO** (estados limpiados correctamente)

---

## 📝 Referencias WebRTC

**Máquina de Estados RTCPeerConnection:**

- Spec: https://www.w3.org/TR/webrtc/#rtcpeerconnectionstate-enum
- Transiciones: https://www.w3.org/TR/webrtc/#dom-rtcpeerconnection-setlocaldescription

**SimplePeer Implementation:**

- Espera a que el peer haya procesado su oferta interna antes de procesar signals remotos
- El evento "signal" es el indicador más confiable de que está listo

---

**Versión:** 2.1 - RTCPeerConnection State Machine Fix
**Implementado:** Mayo 18, 2026
**Impacto:** Videollamadas reproducibles sin errores de estado
