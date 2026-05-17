import { db } from "./Firebase.js";
import { requireAuth, bindLogout, initials } from "./app.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const nombreInput = document.getElementById("nombrePerfil");
const usuarioInput = document.getElementById("usuarioPerfil");
const correoInput = document.getElementById("correoPerfil");
const telefonoInput = document.getElementById("telefonoPerfil");
const btnGuardar = document.getElementById("btnGuardarPerfil");
const avatar = document.getElementById("perfilAvatar");
const title = document.getElementById("perfilTitle");
const subtitle = document.getElementById("perfilSubtitle");

let miUID = null;

requireAuth((user, profile) => {
  miUID = user.uid;
  nombreInput.value = profile.nombre || "";
  usuarioInput.value = profile.usuario || "";
  correoInput.value = profile.correo || user.email || "";
  telefonoInput.value = profile.telefono || "";
  avatar.textContent = initials(profile.nombre || profile.usuario);
  title.textContent = profile.nombre || "Mi perfil";
  subtitle.textContent = `@${profile.usuario || "usuario"}`;
});

btnGuardar.addEventListener("click", async () => {
  if (!miUID) return;
  try {
    await updateDoc(doc(db, "usuarios", miUID), {
      nombre: nombreInput.value.trim(),
      usuario: usuarioInput.value.trim(),
      usuarioLower: usuarioInput.value.trim().toLowerCase(),
      correo: correoInput.value.trim(),
      telefono: telefonoInput.value.trim()
    });
    alert("Tus datos se guardaron correctamente.");
  } catch (error) {
    console.error("Error al guardar:", error);
    alert("Hubo un error al guardar tus datos.");
  }
});

bindLogout();
