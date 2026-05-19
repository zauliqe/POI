import { db } from "./Firebase.js";
import { requireAuth } from "./app.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
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

  marcarRecompensasDesbloqueadas(profile.recompensasDesbloqueadas || []);
});

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    if (!me) return;

    const rewardName = button.dataset.reward;
    const rewardId = button.dataset.rewardId || rewardName;
    const cost = Number(button.dataset.cost || 0);

    const userRef = doc(db, "usuarios", me.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      alert("No se encontró tu usuario.");
      return;
    }

    const userData = userSnap.data();
    const currentPoints = Number(userData.puntos || 0);
    const desbloqueadas = userData.recompensasDesbloqueadas || [];

    if (desbloqueadas.includes(rewardId)) {
      alert("Ya tienes esta recompensa desbloqueada.");
      return;
    }

    if (currentPoints < cost) {
      alert("No tienes suficientes puntos.");
      return;
    }

    const nextPoints = currentPoints - cost;

    await updateDoc(userRef, {
      puntos: nextPoints,
      recompensasDesbloqueadas: arrayUnion(rewardId)
    });

    await addDoc(collection(db, "canjes"), {
      uid: me.uid,
      recompensa: rewardName,
      recompensaId: rewardId,
      costo: cost,
      fecha: serverTimestamp()
    });

    points.textContent = nextPoints;
    button.textContent = "Desbloqueado";
    button.classList.add("disabled");
    if (rewardId === "tema_premium") {
  document.body.classList.add("premiumTheme");
}

    alert("Sticker especial desbloqueado. Ahora puedes usarlo en el chat.");
  });
});

function marcarRecompensasDesbloqueadas(desbloqueadas) {
  if (desbloqueadas.includes("tema_premium")) {
    document.body.classList.add("premiumTheme");
  }

  buttons.forEach((button) => {
    const rewardName = button.dataset.reward;
    const rewardId = button.dataset.rewardId || rewardName;

    if (desbloqueadas.includes(rewardId)) {
      button.textContent = "Desbloqueado";
      button.classList.add("disabled");
    }
  });
}