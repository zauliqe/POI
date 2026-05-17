import { auth, db } from "./Firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const btnEntrar = document.getElementById("btnEntrar");
const identificadorInput = document.getElementById("correoLogin");
const passwordInput = document.getElementById("passwordLogin");

btnEntrar.addEventListener("click", iniciarSesion);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") iniciarSesion();
});

async function iniciarSesion() {
  const identificador = identificadorInput.value.trim();
  const password = passwordInput.value;

  if (!identificador || !password) {
    alert("Por favor llena ambos campos.");
    return;
  }

  let correoParaLogin = identificador;

  try {
    if (!identificador.includes("@")) {
      correoParaLogin = await buscarCorreoPorUsuario(identificador);
      if (!correoParaLogin) {
        alert("No se encontró ninguna cuenta con ese nombre de usuario.");
        return;
      }
    }

    await signInWithEmailAndPassword(auth, correoParaLogin, password);
    window.location.href = "dashboard.html";
  } catch (error) {
    console.error("Error al iniciar sesión:", error);

    if (error.code === "auth/invalid-credential") {
      alert("La contraseña es incorrecta o los datos no coinciden.");
    } else if (error.code === "auth/invalid-email") {
      alert("Formato de correo inválido.");
    } else if (error.code === "permission-denied") {
      alert("Firebase no permite buscar usuarios antes de iniciar sesión. Entra con correo o ajusta las reglas de Firestore para permitir leer usuarios.");
    } else {
      alert(`Hubo un error al iniciar sesión: ${error.code || error.message}`);
    }
  }
}

async function buscarCorreoPorUsuario(usuario) {
  const normalizado = usuario.toLowerCase();
  let resultados = await getDocs(query(collection(db, "usuarios"), where("usuarioLower", "==", normalizado)));

  if (resultados.empty) {
    resultados = await getDocs(query(collection(db, "usuarios"), where("usuario", "==", usuario)));
  }

  if (resultados.empty) return "";
  return resultados.docs[0].data().correo || "";
}
