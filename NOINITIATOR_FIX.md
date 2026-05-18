# Fix: Video/Audio No Se Muestra - Deadlock en Non-Initiator

## 🔴 El Problema

**Síntomas:**

- ✅ Llamada establece conexión (estado = "activa")
- ✅ Signals se intercambian (19-22 candidates)
- ❌ NO se ve video del otro usuario
- ❌ NO se escucha audio
- ✅ Debug muestra todo sin errores

## 📍 Localización del Problema

**Archivo:** `chat.js`  
**Funciones:** `createPeerConnection()` + `listenCallDocument()`

### Escenario de Fallo

```
CALLER (initiator=true)          CALLEE (initiator=false)
────────────────────────────────  ───────────────────────────────
createPeerConnection()
  initiator=true
  Emite offer automáticamente ✅
  peerSignalReady = true

[Firestore: offer]

                                  createPeerConnection()
                                    initiator=false
                                    peerSignalReady = false ❌

                                  listenCallDocument()
                                    Recibe offer
                                    peerSignalReady = false
                                    → ENCOLA offer ❌

                                  Timeout 50ms se ejecuta
                                  peerSignalReady = true
                                  Procesa cola (offer)
                                  Emite answer ✅

[Firestore: answer]
                                  PERO: offer NO fue procesado
                                  a tiempo (encolado)
                                  Answer NO fue recibido por caller
                                  → NO CONECTA
```

## 🎯 La Raíz del Problema

**SimplePeer behaves differently for initiator vs non-initiator:**

```javascript
// Initiator (CALLER)
initiator: true
  → SimplePeer genera offer automáticamente
  → Emite evento "signal" con offer
  → peerSignalReady se marca TRUE cuando emite offer
  → Listo para procesar signals remotos (answer)

// Non-Initiator (CALLEE)
initiator: false
  → SimplePeer NO genera signals automáticamente
  → SimplePeer ESPERA recibir offer
  → Solo emite "signal" DESPUÉS de procesar offer
  → peerSignalReady se marca TRUE... pero es muy tarde
  → Los signals (incluido offer) ya fueron encolados
```

**El Deadlock:**

```
1. Callee recibe offer
2. peerSignalReady = false → oferta se ENCOLA
3. Timeout de 50ms procesa la cola
4. PERO el listener de onSnapshot() ya pasó
5. listenCallDocument() no reintenta
6. El offer encolado se procesa pero ya es viejo
7. WebRTC connection fallida
8. ∞ Nunca se ve video
```

## ✅ La Solución Implementada

### Parte 1: Marcar Non-Initiator Como Listo Inmediatamente

En `createPeerConnection()`, después de crear SimplePeer:

```javascript
// Para non-initiator (callee), marcar listo INMEDIATAMENTE
if (!isCaller) {
  setTimeout(() => {
    if (!peerSignalReady && callPeer && callPeer._pc) {
      peerSignalReady = true;
      addDebugLog(`🎯 Non-initiator listo para procesar signals`);

      // Procesar signals encolados (especialmente el offer)
      if (pendingSignals.length > 0) {
        for (const sig of pendingSignals.splice(0)) {
          callPeer.signal(sig);
        }
      }
    }
  }, 50);
}
```

**¿Por qué funciona?**

- Non-initiator ESTÁ LISTO desde que se crea (no necesita generar offer)
- El timeout de 50ms le da tiempo al RTCPeerConnection interno para inicializarse
- Procesa signals encolados DENTRO del timeout
- Genera answer y la envía a Firestore

### Parte 2: Procesar Cola En Cada Snapshot

En `listenCallDocument()`, después de procesar signals normales:

```javascript
// Si peerSignalReady es ahora true pero hay signals encolados,
// procesarlos en el siguiente ciclo
if (peerSignalReady && pendingSignals.length > 0) {
  const pending = pendingSignals.splice(0);
  for (const sig of pending) {
    callPeer.signal(sig);
  }
}
```

**¿Por qué es necesario?**

- Cubre race condition donde signals llegan ANTES de que timeout se ejecute
- Listener continúa verificando si hay signals encolados
- Procesa signals en el siguiente snapshot

### Parte 3: Evitar Duplicados en Cola

```javascript
if (
  !pendingSignals.find(
    (s) => JSON.stringify(s) === JSON.stringify(signalItem.signal),
  )
) {
  pendingSignals.push(signalItem.signal);
}
```

**Previene:**

- Signals duplicados en la cola
- Procesamiento múltiple del mismo signal

## 🔄 Flujo Post-Corrección

```
CALLER (initiator=true)          CALLEE (initiator=false)
────────────────────────────────  ───────────────────────────────
createPeerConnection()
  initiator=true
  Emite offer ✅

[Firestore: offer]

                                  createPeerConnection()
                                    initiator=false
                                    peerSignalReady = false
                                    Timeout inicia (50ms)

                                  listenCallDocument()
                                    Recibe offer
                                    peerSignalReady = false
                                    → ENCOLA offer

                                  Timeout se ejecuta (50ms)
                                  peerSignalReady = true ✅
                                  Procesa offer ✅
                                  Emite answer ✅

[Firestore: answer]

listenCallDocument()
  Recibe answer
  peerSignalReady = true
  → PROCESA answer ✅
  Conexión establece ✅

                                  [VIDEO Y AUDIO VISIBLES] ✅
```

## 📊 Cambios Exactos

### En `createPeerConnection()`

**Agregado:**

```javascript
// Para non-initiator, marcar listo en timeout
if (!isCaller) {
  setTimeout(() => {
    if (!peerSignalReady && callPeer && callPeer._pc) {
      peerSignalReady = true;
      addDebugLog(`🎯 Non-initiator listo...`);

      // Procesar signals encolados
      if (pendingSignals.length > 0) {
        /*...*/
      }
    }
  }, 50);
}
```

**Modificado - Evento "signal":**

```javascript
// Ahora solo para initiator
if (isCaller && !peerSignalReady) {
  peerSignalReady = true;
  // Procesar cola
}
```

### En `listenCallDocument()`

**Agregado - Después de procesar signals:**

```javascript
// Procesar signals encolados cuando peer finalmente está listo
if (peerSignalReady && pendingSignals.length > 0) {
  for (const sig of pendingSignals.splice(0)) {
    callPeer.signal(sig);
  }
}
```

**Modificado - Deduplicación:**

```javascript
// No encolar duplicados
if (
  !pendingSignals.find(
    (s) => JSON.stringify(s) === JSON.stringify(signalItem.signal),
  )
) {
  pendingSignals.push(signalItem.signal);
}
```

## 🧪 Cómo Verificar que Funciona

**Debug esperado para CALLEE:**

```
[3:35:00] ✅ SimplePeer creado. Stream local: 2 tracks
[3:35:00] 👂 Escuchando documento de llamada
[3:35:00] ⏳ SimplePeer aún no listo, encolando signal offer ← ENCOLA
[3:35:00] 📄 Estado llamada: activa, signals: 22, peer: ✅
[3:35:00] 🎯 Non-initiator listo para procesar signals ← TIMEOUT
[3:35:00] 📦 Procesando 1 signals pendientes... ← PROCESA COLA
[3:35:00] ✅ Signal pendiente procesado (offer) ← PROCESA OFFER
[3:35:00] 📤 Signal emitido: answer ← GENERA ANSWER
[3:35:01] ✅ Peer conectado exitosamente ← CONEXIÓN OK
[3:35:01] 🎥 Stream remoto recibido: 2 tracks ← VIDEO VISIBLE ✅
```

## 🚨 Errores Prevenidos

- ✅ Non-initiator no genera answer
- ✅ Caller no recibe answer → No se conecta
- ✅ No hay video/audio del otro
- ✅ Conexión falla silenciosamente

Ahora todos estos errores están **PREVENIDOS**.

## 📝 Key Insight

**Non-initiator (callee) está listo INMEDIATAMENTE después de createPeerConnection()**, no necesita esperar a que emita "signal". El "signal" event viene DESPUÉS de procesar el offer.

**Solución:** Marcar listo en timeout + procesar cola en cada snapshot = cobertura de race conditions.

---

**Versión:** 2.2 - Non-Initiator Signal Processing Fix  
**Implementado:** Mayo 18, 2026  
**Impacto:** Video/audio visible en ambos lados de la videollamada
