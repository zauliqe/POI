// Importar Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { 
getFirestore 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
getAuth
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// CONFIGURACION
const firebaseConfig = {
  apiKey: "AIzaSyDorkeua4jkgxMtNs9unE4yJlLSo2DRk-4",
  authDomain: "camollin00.firebaseapp.com",
  projectId: "camollin00",
  storageBucket: "camollin00.appspot.com",
  messagingSenderId: "670275619839",
  appId: "1:670275619839:web:878b26a2aa9f1732f0b5ca"
};


// iniciar firebase
const app = initializeApp(firebaseConfig);


// base de datos
export const db = getFirestore(app);


// autenticación
export const auth = getAuth(app);


// exportar
// export { db, auth };

console.log("Firebase conectado");