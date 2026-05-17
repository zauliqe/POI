import { db } from "./Firebase.js";
import { requireAuth } from "./app.js";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const points = document.getElementById("puntosUsuario");
const buttons = document.querySelectorAll("[data-reward]");
let me = null;
let profile = null;

requireAuth((user, userProfile) => {
  me = user;
  profile = userProfile;
  points.textContent = profile.puntos ?? 120;
});

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!me) return;
    const cost = Number(button.dataset.cost || 0);
    const current = Number(points.textContent || 0);
    if (current < cost) {
      alert("No tienes suficientes puntos.");
      return;
    }

    const next = current - cost;
    await updateDoc(doc(db, "usuarios", me.uid), { puntos: next });
    await addDoc(collection(db, "canjes"), {
      uid: me.uid,
      recompensa: button.dataset.reward,
      costo: cost,
      fecha: serverTimestamp()
    });
    points.textContent = next;
    alert("Recompensa canjeada.");
  });
});
