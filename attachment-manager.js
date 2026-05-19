/**
 * ATTACHMENT MANAGER - Gestiona compartición de archivos en el chat
 * Soporta: imágenes, documentos, videos, audio
 */

import { db, storage } from "./Firebase.js";
import { doc, addDoc, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg"
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export class AttachmentManager {
  constructor() {
    this.selectedFile = null;
  }

  /**
   * Validar archivo antes de subir
   */
  validateFile(file) {
    if (!file) return { valid: false, error: "No se seleccionó archivo" };
    
    if (!ALLOWED_TYPES[file.type]) {
      return { valid: false, error: "Tipo de archivo no permitido" };
    }
    
    if (file.size > MAX_FILE_SIZE) {
      return { valid: false, error: "El archivo es muy grande (máx 50 MB)" };
    }
    
    return { valid: true, error: null };
  }

  /**
   * Seleccionar archivo
   */
  selectFile(file) {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    this.selectedFile = {
      file: file,
      name: file.name,
      size: this.formatFileSize(file.size),
      type: file.type,
      icon: this.getFileIcon(file.type)
    };
    
    return this.selectedFile;
  }

  /**
   * Obtener ícono según tipo de archivo
   */
  getFileIcon(mimeType) {
    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType.startsWith("video/")) return "🎥";
    if (mimeType.startsWith("audio/")) return "🎵";
    if (mimeType === "application/pdf") return "📄";
    if (mimeType.includes("word")) return "📝";
    if (mimeType.includes("sheet")) return "📊";
    return "📎";
  }

  /**
   * Formatear tamaño de archivo
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Subir archivo a Firebase Storage
   */
  async uploadFile() {
    if (!this.selectedFile) {
      throw new Error("No hay archivo seleccionado");
    }

    const file = this.selectedFile.file;
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 9);
    const storageRef = ref(storage, `attachments/${timestamp}_${randomStr}_${file.name}`);

    try {
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      return {
        name: file.name,
        type: file.type,
        size: file.size,
        url: downloadURL,
        timestamp: timestamp
      };
    } catch (error) {
      throw new Error(`Error subiendo archivo: ${error.message}`);
    }
  }

  /**
   * Guardar adjunto en Firestore
   */
  async saveAttachmentMessage(conversationId, userId, attachmentData) {
    try {
      const messagesRef = collection(db, "conversaciones", conversationId, "mensajes");
      
      await addDoc(messagesRef, {
        uid: userId,
        usuario: attachmentData.usuario,
        nombre: attachmentData.nombre,
        tipo: "archivo",
        archivo: {
          nombre: attachmentData.name,
          tipo: attachmentData.type,
          tamaño: attachmentData.size,
          url: attachmentData.url
        },
        fecha: serverTimestamp()
      });

      // Actualizar timestamp de conversación
      await setDoc(doc(db, "conversaciones", conversationId), {
  ultimoMensaje: `📎 ${attachmentData.name}`,
  ultimoMensajeDe: userId,
  actualizado: serverTimestamp()
}, { merge: true });

    } catch (error) {
      throw new Error(`Error guardando archivo en chat: ${error.message}`);
    }
  }

  /**
   * Limpiar archivo seleccionado
   */
  clearSelection() {
    this.selectedFile = null;
  }

  /**
   * Obtener archivo seleccionado
   */
  getSelectedFile() {
    return this.selectedFile;
  }
}

// Exportar instancia singleton
export const attachmentManager = new AttachmentManager();
