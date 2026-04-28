// chat.js
import { db, auth } from "./Firebase.js"; 
import { collection, addDoc, onSnapshot, orderBy, query, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

console.log("chat.js cargado");
const boton = document.getElementById("enviar");
const mensaje = document.getElementById("mensaje");
const chat = document.getElementById("chat");

let miPerfil = null;
let miUID = null; // Necesitamos tu ID para saber cuáles mensajes son tuyos

// 1. Detectar usuario y traer su info
onAuthStateChanged(auth, async (user) => {
  if (user) {
    miUID = user.uid; // Guardamos tu ID secreto
    const docRef = doc(db, "usuarios", miUID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      miPerfil = docSnap.data(); 
    }
  } else {
    window.location.href = "login.html"; 
  }
});

// 2. ENVIAR MENSAJE
boton.addEventListener("click", async () => {
   const texto = mensaje.value;
   if(texto === "") return;

   if(!miPerfil || !miUID){
      alert("Cargando tus datos...");
      return;
   }

   // Guardamos en Firebase (Agregamos el UID para identificar de quién es)
   await addDoc(collection(db, "mensajes"), {
      uid: miUID,                // <--- NUEVO: Clave para identificar tus mensajes
      usuario: miPerfil.usuario, 
      texto: texto,
      fecha: Date.now()
   });
   
   mensaje.value = ""; 
});

// 3. LEER MENSAJES CON ESTILO WHATSAPP
const q = query(collection(db, "mensajes"), orderBy("fecha"));
onSnapshot(q, (snapshot) => {
   chat.innerHTML = ""; 
   
   snapshot.forEach((documento) => {
      const data = documento.data();
      
      // PREGUNTA CLAVE: ¿Este mensaje lo envié yo?
      const esMio = data.uid === miUID; 
      
      // Lógica de diseño según quién lo envió
      const alineacion = esMio ? "flex-end" : "flex-start"; // Derecha si es mío, izquierda si no
      const colorFondo = esMio ? "#1a4731" : "#2a2a2a";     // Verde oscuro si es mío, gris oscuro si no
      const colorNombre = esMio ? "#85e0b3" : "#a0a0a0";    // Color del @usuario

      chat.innerHTML += `
      <div style="display: flex; justify-content: ${alineacion}; margin-bottom: 12px; width: 100%;">
        <div style="background-color: ${colorFondo}; color: #ffffff; padding: 10px 14px; border-radius: 12px; max-width: 75%; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
           <b style="font-size: 11px; color: ${colorNombre}; display: block; margin-bottom: 4px;">
              @${data.usuario}
           </b>
           <span style="font-size: 14px; line-height: 1.4;">${data.texto}</span>
        </div>
      </div>
      `;
   });
   
   // Auto-scroll hacia abajo
   chat.scrollTop = chat.scrollHeight;
});