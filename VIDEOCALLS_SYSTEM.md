# Sistema Robusto de Videollamadas - CamOllin

## 📋 Resumen de Cambios

Se implementó un sistema más robusto para manejar videollamadas con validación de estado, prevención de errores y mejor manejo de ciclos de vida.

## 🔧 Archivos Nuevos

### `call-manager.js`

Gestor centralizado que rastrea el estado de todas las videollamadas.

**Estados de Llamada:**

- `initializing` - Inicializando recursos
- `connecting` - Estableciendo conexión P2P
- `connected` - Conexión activa, video en vivo
- `failed` - Error no recuperable
- `ended` - Finalizada exitosamente

**Métodos Principales:**

- `createCall(callId, config)` - Crear nueva llamada
- `getCall(callId)` - Obtener estado
- `updateCallStatus(callId, status)` - Actualizar estado
- `isCallHealthy(callId)` - Validar que sea seguro procesar signals
- `setPeerReady(callId, ready)` - Marcar cuando SimplePeer está listo
- `setStreamReady(callId, ready)` - Marcar cuando stream local está listo
- `recordSignalApplied(callId, type)` - Registrar signal procesado
- `endCall(callId)` - Finalizar y limpiar

## 🛡️ Mejoras de Robustez

### 1. **Validación de Estado Antes de Procesar Signals**

```javascript
const callHealth = callManager.isCallHealthy(callSessionId);
if (!callHealth && data.estado !== "finalizada") {
  addDebugLog(`⚠️ Llamada no en estado saludable, ignorando signals`);
  return;
}
```

**Beneficio:** Evita aplicar signals a peers en estado inconsistente o destruidos.

### 2. **Detección de Peer Destruido**

```javascript
if (!callPeer || !callPeer._pc) {
  addDebugLog(`⚠️ Peer fue destruido, ignorando signal ${signalItem.signal.type}`);
  break;
}
```

**Beneficio:** Detiene el procesamiento cuando SimplePeer ha sido destruido en background.

### 3. **Manejo de Errores en SimplePeer**

```javascript
callPeer.on("error", (err) => {
  callManager.updateCallStatus(callSessionId, "failed");
  // Destruir peer explícitamente para evitar état zombi
  if (callPeer) {
    try {
      callPeer.destroy();
    } catch (e) {}
    callPeer = null;
  }
});
```

**Beneficio:** Evita el estado "zombie" donde el peer existe pero está inutilizable.

### 4. **IDs Únicos por Llamada**

```javascript
const uniqueCallId = `${activeConversation.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

**Beneficio:** Cada llamada obtiene un ID completamente único, sin reutilización.

### 5. **Limpieza de Signals en Transiciones**

- Cuando se crea una llamada: `signals: []`
- Cuando se rechaza: `signals: []`
- Cuando se finaliza: `signals: []`

**Beneficio:** Evita que signals viejos contaminen nuevas llamadas.

## 📊 Debug Mejorado

El sistema ahora registra:

- ✅ Transiciones de estado
- 📡 Cuándo peer está listo
- 🎥 Cuándo stream está listo
- 📦 Signals aplicados exitosamente
- ⚠️ Intentos fallidos de procesar signals
- 🔴 Detección de peers destruidos

**Acceder:**

1. Iniciar una videollamada
2. En el overlay, hacer clic en "Mostrar Debug"
3. Ver logs en tiempo real del estado de la llamada

## 🚀 Flujo de Operación

```
1. Usuario A hace clic en "Llamar"
   ↓
2. Se genera ID único: abc123_timestamp_random
   ↓
3. callManager.createCall(id, config)
   ↓
4. Se solicita acceso a cámara/micrófono
   ↓
5. callManager.setStreamReady(id, true)
   ↓
6. Se crea SimplePeer
   ↓
7. callManager.setPeerReady(id, true)
   ↓
8. Estado: "connecting" - listo para recibir signals
   ↓
9. Usuario B recibe notificación
   ↓
10. Usuario B acepta
    ↓
11. Se crea nuevo SimplePeer en usuario B con mismo ID
    ↓
12. Intercambio de signals (validado por callManager)
    ↓
13. Cuando conecta: Estado = "connected"
    ↓
14. Usuario cuelga o timeout → endCall()
    ↓
15. Limpieza completa, llamada disponible para reintento
```

## ✅ Verificaciones de Salud

El sistema verifica constantemente:

```javascript
// Antes de procesar signal:
- ¿Existe la llamada en callManager? ✅
- ¿El estado es válido? ✅
- ¿El peer no está destruido? ✅
- ¿Ya hemos visto este signal? ✅
```

## 🧪 Prueba del Sistema

**Primera llamada:**

1. Usuario A llama a Usuario B
2. Ambos ven:
   - `🚀 Iniciando sesión...`
   - `📡 SimplePeer creado`
   - `📥 Signal remoto recibido: offer`
   - `✅ Peer conectado exitosamente`

**Segunda llamada (sin recargar):**

1. Colgar primera
2. Usuario A llama de nuevo
3. Verá un ID diferente en logs
4. Mismo flujo exitoso sin errores de "cached state"

**Si ves errores:**

- `❌ Error aplicando signal: cannot signal after peer is destroyed`
  → El sistema ahora lo detecta y detiene procesamiento
- `⚠️ Llamada no en estado saludable`
  → El callManager evitó un error potencial

## 📝 Campos Rastreados por Llamada

```javascript
{
  id: "abc123_1234567890_xyz",
  status: "connected",
  isCaller: true,
  remoteName: "Erick saul",
  peerReady: true,
  streamReady: true,
  signalsApplied: 42,
  retries: 0,
  createdAt: 1715975200000,
  duration: 125000, // ms
  lastSignal: "2:30:15 PM"
}
```

## 🔄 Próximas Mejoras Posibles

1. **Reintentos Automáticos**: Si falla, reintentar hasta 3 veces
2. **Timeout de Conexión**: Si no conecta en 30s, abortar
3. **Historial de Llamadas**: Guardar en Firestore
4. **Estadísticas**: Duración promedio, tasa de éxito
5. **Fallback Audio-Only**: Si video falla, continuar con audio

## 🐛 Troubleshooting

**Problema:** Videollamada se cierra después de unos segundos

- **Antes:** SimplePeer error destruía el peer, signals seguían llegando
- **Ahora:** Sistema detecta peer destruido y detiene procesamiento

**Problema:** La segunda llamada no funciona

- **Antes:** Signals viejos contaminaban la nueva llamada
- **Ahora:** Cada llamada tiene ID único y signals limpios

**Problema:** Errores "Called in wrong state: stable"

- **Antes:** Aplicaba signals sin validar estado WebRTC
- **Ahora:** Valida salud antes de cada operación

---

**Sistema implementado el:** Mayo 18, 2026
**Versión:** 2.0 - Robusto
