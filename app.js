import { auth, db } from "./Firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initials(value = "U") {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U";
}

export function privateConversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export function currentConversationId() {
  return new URLSearchParams(window.location.search).get("c");
}

export function formatDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
  return date.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export function isUserOnline(data = {}) {
  const last = data.ultimoActivo?.toDate ? data.ultimoActivo.toDate().getTime() : data.ultimoActivo;
  return data.estado === "online" && Boolean(last && Date.now() - last < 180000);
}

export async function ensureUserProfile(user) {
  const userRef = doc(db, "usuarios", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return { uid: user.uid, ...snap.data() };

  const fallback = {
    nombre: user.displayName || "Usuario",
    usuario: user.email?.split("@")[0] || "usuario",
    correo: user.email || "",
    telefono: "",
    estado: "offline",
    ultimoActivo: null,
    puntos: 120
  };
  await setDoc(userRef, fallback, { merge: true });
  return { uid: user.uid, ...fallback };
}

export function applyPremiumTheme(profile = {}) {
  const desbloqueadas = profile.recompensasDesbloqueadas || [];

  if (desbloqueadas.includes("tema_premium")) {
    document.body.classList.add("premiumTheme");
  } else {
    document.body.classList.remove("premiumTheme");
  }
}

export function requireAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const profile = await ensureUserProfile(user);
applyPremiumTheme(profile);
await setOnline(user.uid);
window.addEventListener("beforeunload", () => setOffline(user.uid).catch(() => {}), { once: true });
callback(user, profile);
  });
}

export async function setOnline(uid) {
  await setDoc(doc(db, "usuarios", uid), {
    estado: "online",
    ultimoActivo: serverTimestamp()
  }, { merge: true });
}

export async function setOffline(uid) {
  await setDoc(doc(db, "usuarios", uid), {
    estado: "offline",
    ultimoActivo: serverTimestamp()
  }, { merge: true });
}

export function bindLogout(buttonId = "btnCerrarSesion") {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.addEventListener("click", async () => {
    if (auth.currentUser) {
      await setOffline(auth.currentUser.uid).catch(() => {});
    }
    await signOut(auth);
    window.location.href = "login.html";
  });
}
