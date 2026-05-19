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
const fotoInput = document.getElementById("fotoPerfilInput");
const photoFrame = document.getElementById("profilePhotoFrame");
const photoPreview = document.getElementById("profilePhotoPreview");
const photoFallback = document.getElementById("profilePhotoFallback");
const btnEliminarFoto = document.getElementById("btnEliminarFoto");

let miUID = null;
let fotoPerfil = "";

requireAuth((user, profile) => {
  miUID = user.uid;
  fotoPerfil = profile.foto || "";
  nombreInput.value = profile.nombre || "";
  usuarioInput.value = profile.usuario || "";
  correoInput.value = profile.correo || user.email || "";
  telefonoInput.value = profile.telefono || "";
  renderIdentity(profile.nombre || profile.usuario, profile.usuario);
  renderPhoto();
});

btnGuardar.addEventListener("click", async () => {
  if (!miUID) return;
  try {
    await updateDoc(doc(db, "usuarios", miUID), {
      nombre: nombreInput.value.trim(),
      usuario: usuarioInput.value.trim(),
      usuarioLower: usuarioInput.value.trim().toLowerCase(),
      correo: correoInput.value.trim(),
      telefono: telefonoInput.value.trim(),
      foto: fotoPerfil
    });
    renderIdentity(nombreInput.value.trim() || usuarioInput.value.trim(), usuarioInput.value.trim());
    renderPhoto();
    alert("Tus datos se guardaron correctamente.");
  } catch (error) {
    console.error("Error al guardar:", error);
    alert("Hubo un error al guardar tus datos.");
  }
});

fotoInput.addEventListener("change", async () => {
  const file = fotoInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Selecciona una imagen válida.");
    fotoInput.value = "";
    return;
  }

  try {
    fotoPerfil = await resizeImage(file);
    renderPhoto();
  } catch (error) {
    console.error("Error al procesar imagen:", error);
    alert("No se pudo cargar la imagen.");
  } finally {
    fotoInput.value = "";
  }
});

btnEliminarFoto.addEventListener("click", () => {
  fotoPerfil = "";
  renderPhoto();
});

function renderIdentity(name, username) {
  const fallback = initials(name || username || "U");
  avatar.innerHTML = fotoPerfil ? `<img src="${fotoPerfil}" alt="">` : fallback;
  photoFallback.textContent = fallback;
  title.textContent = name || "Mi perfil";
  subtitle.textContent = `@${username || "usuario"}`;
}

function renderPhoto() {
  if (fotoPerfil) {
    photoPreview.src = fotoPerfil;
    photoFrame.classList.add("hasPhoto");
    avatar.innerHTML = `<img src="${fotoPerfil}" alt="">`;
  } else {
    photoPreview.removeAttribute("src");
    photoFrame.classList.remove("hasPhoto");
    avatar.textContent = initials(nombreInput.value || usuarioInput.value || "U");
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 360;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

bindLogout();
