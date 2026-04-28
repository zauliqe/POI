// perfil.js
import { auth, db } from "./Firebase.js"; // Asegúrate de que importamos db también
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Atrapamos los elementos del HTML por su ID
const nombreInput = document.getElementById("nombrePerfil");
const usuarioInput = document.getElementById("usuarioPerfil");
const correoInput = document.getElementById("correoPerfil");
const btnGuardar = document.getElementById("btnGuardarPerfil");

// Variable para recordar quién es el usuario logueado
let miUID = null;

// 1. Detectamos al usuario logueado y traemos sus datos de Firestore
onAuthStateChanged(auth, async (user) => {
  if (user) {
    miUID = user.uid; // Guardamos su ID secreto
    
    // Vamos a Firestore a buscar el documento de ESTE usuario
    const docRef = doc(db, "usuarios", miUID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const misDatos = docSnap.data();
      // Ponemos los datos de la base de datos dentro de las cajitas
      nombreInput.value = misDatos.nombre;
      usuarioInput.value = misDatos.usuario;
      correoInput.value = misDatos.correo;
    }
  } else {
    // Si no está logueado, lo mandamos al login
    window.location.href = "login.html";
  }
});

// 2. Hacer que el botón Guardar funcione
btnGuardar.addEventListener("click", async () => {
    if (miUID) {
        try {
            // Apuntamos al documento del usuario
            const docRef = doc(db, "usuarios", miUID);
            
            // Actualizamos solo los campos que pudo haber modificado
            await updateDoc(docRef, {
                nombre: nombreInput.value,
                usuario: usuarioInput.value
            });
            
            alert("¡Tus datos se guardaron correctamente!");
        } catch (error) {
            console.error("Error al guardar: ", error);
            alert("Hubo un error al guardar tus datos.");
        }
    }
          // Atrapamos el botón de cerrar sesión
          const btnCerrar = document.getElementById("btnCerrarSesion");

          // Le damos la funcionalidad
          btnCerrar.addEventListener("click", async () => {
          try {
              await signOut(auth); // Le avisa a Firebase que cierre la sesión
              window.location.href = "login.html"; // Te regresa a la pantalla de login
          } catch (error) {
              console.error("Error al cerrar sesión: ", error);
          }
  });

});