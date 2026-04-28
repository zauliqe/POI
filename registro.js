import { auth, db } from "./firebase.js";

import {
createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
doc,
setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";



const boton = document.getElementById("btnRegistro");

boton.addEventListener("click", async () => {

const nombre = document.getElementById("nombre").value;
const usuario = document.getElementById("usuario").value;
const correo = document.getElementById("correo").value;
const telefono = document.getElementById("telefono").value;
const password = document.getElementById("password").value;
const confirmar = document.getElementById("confirmar").value;


if(password !== confirmar){
alert("Las contraseñas no coinciden");
return;
}


try{

// crear usuario en authentication
const userCredential = await createUserWithEmailAndPassword(
auth,
correo,
password
);

const user = userCredential.user;


// guardar datos en firestore
await setDoc(doc(db,"usuarios",user.uid),{

nombre:nombre,
usuario:usuario,
correo:correo,
telefono:telefono

});


alert("Usuario registrado correctamente");

window.location.href="login.html";


}catch(error){

console.error(error);
alert(error.message);

}

});