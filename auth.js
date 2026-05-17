// Importamos lo necesario para guardar en Firestore
import { auth, db } from "./Firebase.js"; 
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Modificamos la función para recibir más datos
export async function registrarUsuario(email, password, nombre, usuario) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // AHORA: Guardamos los datos extra en la base de datos (Firestore)
    // Usamos el UID (ID único del usuario) como nombre del documento
    await setDoc(doc(db, "usuarios", user.uid), {
      correo: email,
      nombre: nombre,
      usuario: usuario,
      foto: "https://cdn-icons-png.flaticon.com/512/149/149071.png", // Foto por defecto
      estado: "online" // Lo ponemos online al registrarse
    });

    console.log("Usuario creado y guardado en BD:", user);
    alert("Cuenta creada correctamente");
    window.location.href = "dashboard.html";
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}
