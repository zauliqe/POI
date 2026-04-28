// esto es un comentario


// login.js
// 1. Importamos auth y TAMBIÉN db
import { auth, db } from "./Firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// 2. Importamos las herramientas para buscar en la base de datos
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const btnEntrar = document.getElementById("btnEntrar");
const identificadorInput = document.getElementById("correoLogin"); // Atrapa la cajita de texto
const passwordInput = document.getElementById("passwordLogin");

btnEntrar.addEventListener("click", async () => {
    // Tomamos lo que el usuario escribió y le quitamos espacios extra
    const identificador = identificadorInput.value.trim(); 
    const password = passwordInput.value;

    if(identificador === "" || password === "") {
        alert("Por favor llena ambos campos");
        return;
    }

    // Por defecto, asumimos que escribió un correo
    let correoParaLogin = identificador;

    try {
        // TRUCO: Si el texto NO tiene un "@", sabemos que escribió su Nombre de Usuario
        if (!identificador.includes("@")) {
            
            // Vamos a la colección "usuarios" y buscamos quién tiene ese "usuario"
            const q = query(collection(db, "usuarios"), where("usuario", "==", identificador));
            const resultados = await getDocs(q);

            // Si la búsqueda está vacía, el usuario no existe
            if (resultados.empty) {
                alert("No se encontró ninguna cuenta con ese nombre de usuario.");
                return;
            }

            // Si lo encuentra, extraemos su correo real de la base de datos
            resultados.forEach((documento) => {
                correoParaLogin = documento.data().correo;
            });
            
            console.log("Usuario encontrado. Correo real:", correoParaLogin);
        }

        // Ahora sí, le damos a Firebase el correo (ya sea el que el usuario escribió, o el que encontramos)
        const userCredential = await signInWithEmailAndPassword(auth, correoParaLogin, password);
        const user = userCredential.user;
        
        console.log("Sesión iniciada correctamente:", user.email);
        
        // Lo mandamos al chat
        window.location.href = "dashboard.html";
        
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        
        if (error.code === 'auth/invalid-credential') {
            alert("La contraseña es incorrecta o los datos no coinciden.");
        } else if (error.code === 'auth/invalid-email') {
            alert("Formato de correo inválido.");
        } else {
            alert("Hubo un error al iniciar sesión.");
        }
    }
});