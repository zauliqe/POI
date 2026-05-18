/**
 * CALL MANAGER - Sistema robusto para gestionar videollamadas
 * Incluye validación de estado, reintentos automáticos y health checks
 */

export class CallManager {
  constructor() {
    this.calls = new Map(); // Almacena estado de cada llamada
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 2000; // ms
    this.HEALTH_CHECK_INTERVAL = 3000; // ms
  }

  /**
   * Crear nueva llamada con estado inicial
   */
  createCall(callId, config = {}) {
    if (this.calls.has(callId)) {
      console.warn(`⚠️ Llamada ${callId} ya existe`);
      return this.calls.get(callId);
    }

    const callState = {
      id: callId,
      status: "initializing", // initializing, connecting, connected, failed, ended
      retries: 0,
      peerReady: false,
      streamReady: false,
      signalsApplied: 0,
      lastSignalTime: null,
      createdAt: Date.now(),
      healthCheckId: null,
      ...config
    };

    this.calls.set(callId, callState);
    console.log(`✅ Nueva llamada creada: ${callId}`);
    return callState;
  }

  /**
   * Obtener estado de llamada
   */
  getCall(callId) {
    return this.calls.get(callId);
  }

  /**
   * Actualizar estado de llamada
   */
  updateCallStatus(callId, status) {
    const call = this.calls.get(callId);
    if (call) {
      const oldStatus = call.status;
      call.status = status;
      console.log(`📊 [${callId}] Estado: ${oldStatus} → ${status}`);
      return true;
    }
    return false;
  }

  /**
   * Marcar que el peer está listo
   */
  setPeerReady(callId, ready) {
    const call = this.calls.get(callId);
    if (call) {
      call.peerReady = ready;
      if (ready) {
        console.log(`📡 [${callId}] Peer listo para recibir signals`);
      }
      return true;
    }
    return false;
  }

  /**
   * Marcar que el stream está listo
   */
  setStreamReady(callId, ready) {
    const call = this.calls.get(callId);
    if (call) {
      call.streamReady = ready;
      if (ready) {
        console.log(`🎥 [${callId}] Stream listo`);
      }
      return true;
    }
    return false;
  }

  /**
   * Validar que la llamada está en buen estado para procesar signals
   */
  isCallHealthy(callId) {
    const call = this.calls.get(callId);
    if (!call) {
      console.warn(`⚠️ Llamada ${callId} no encontrada`);
      return false;
    }

    const isHealthy =
      call.status === "connecting" ||
      call.status === "connected" ||
      call.status === "initializing";

    if (!isHealthy) {
      console.warn(`⚠️ [${callId}] Llamada en estado ${call.status}, no se puede procesar signals`);
    }

    return isHealthy;
  }

  /**
   * Registrar signal aplicado
   */
  recordSignalApplied(callId, signalType) {
    const call = this.calls.get(callId);
    if (call) {
      call.signalsApplied++;
      call.lastSignalTime = Date.now();
      console.log(`📦 [${callId}] Signal aplicado: ${signalType} (total: ${call.signalsApplied})`);
    }
  }

  /**
   * Registrar intento fallido
   */
  recordRetry(callId) {
    const call = this.calls.get(callId);
    if (call) {
      call.retries++;
      console.log(`🔄 [${callId}] Reintento ${call.retries}/${this.MAX_RETRIES}`);
      return call.retries <= this.MAX_RETRIES;
    }
    return false;
  }

  /**
   * Finalizar llamada
   */
  endCall(callId) {
    const call = this.calls.get(callId);
    if (call) {
      if (call.healthCheckId) {
        clearInterval(call.healthCheckId);
      }
      call.status = "ended";
      console.log(`🏁 [${callId}] Llamada finalizada. Duración: ${Date.now() - call.createdAt}ms`);
      // Mantener registro por 30 segundos antes de limpiar
      setTimeout(() => this.calls.delete(callId), 30000);
      return true;
    }
    return false;
  }

  /**
   * Obtener resumen de llamada para debugging
   */
  getCallSummary(callId) {
    const call = this.calls.get(callId);
    if (!call) return null;

    return {
      id: call.id,
      status: call.status,
      duration: Date.now() - call.createdAt,
      peerReady: call.peerReady,
      streamReady: call.streamReady,
      signalsApplied: call.signalsApplied,
      retries: call.retries,
      lastSignal: call.lastSignalTime ? new Date(call.lastSignalTime).toLocaleTimeString() : "nunca"
    };
  }

  /**
   * Obtener todas las llamadas activas
   */
  getActiveCalls() {
    return Array.from(this.calls.values()).filter(
      call => call.status !== "ended"
    );
  }
}

// Singleton instance
export const callManager = new CallManager();
