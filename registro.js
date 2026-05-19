import { auth, db } from "./Firebase.js";
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const boton = document.getElementById("btnRegistro");

boton.addEventListener("click", async () => {
  const nombre = document.getElementById("nombre").value.trim();
  const usuario = document.getElementById("usuario").value.trim();
  const correo = document.getElementById("correo").value.trim();
  const telefono = document.getElementById("telefono").value.trim();
  const password = document.getElementById("password").value;
  const confirmar = document.getElementById("confirmar").value;

  if (!nombre || !usuario || !correo || !password) {
    alert("Completa nombre, usuario, correo y contraseña.");
    return;
  }

  if (password !== confirmar) {
    alert("Las contraseñas no coinciden.");
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, correo, password);
    const user = userCredential.user;

    await setDoc(doc(db, "usuarios", user.uid), {
  nombre,
  usuario,
  usuarioLower: usuario.toLowerCase(),
  correo,
  telefono,
  foto: "",
  estado: "offline",
  ultimoActivo: serverTimestamp(),
  puntos: 120,
  recompensasDesbloqueadas: [],
  creado: serverTimestamp()
});

    await signOut(auth);
    alert("Usuario registrado correctamente. Ahora inicia sesión.");
    window.location.href = "login.html";
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
});
