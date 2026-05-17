import { db } from "./Firebase.js";
import { requireAuth } from "./app.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("tareaForm");
const titulo = document.getElementById("tituloTarea");
const fecha = document.getElementById("fechaTarea");
const asignado = document.getElementById("asignadoTarea");
const prioridad = document.getElementById("prioridadTarea");
const descripcion = document.getElementById("descripcionTarea");
const grupoNombre = document.getElementById("grupoNombre");

let me = null;
let profile = null;
let grupoId = new URLSearchParams(window.location.search).get("g") || localStorage.getItem("grupoActivo");

requireAuth(async (user, userProfile) => {
  me = user;
  profile = userProfile;
  if (!grupoId) {
    alert("Selecciona un grupo antes de crear una tarea.");
    window.location.href = "tareas-grupo.html";
    return;
  }

  const snap = await getDoc(doc(db, "grupos", grupoId));
  if (!snap.exists()) {
    alert("No se encontró el grupo.");
    window.location.href = "tareas-grupo.html";
    return;
  }

  const group = snap.data();
  grupoNombre.textContent = group.nombre || "Grupo";
  await loadMembers(group.miembros || []);
});

async function loadMembers(memberIds) {
  asignado.innerHTML = `<option value="Equipo">Equipo</option>`;

  for (const uid of memberIds) {
    const snap = await getDoc(doc(db, "usuarios", uid));
    if (!snap.exists()) continue;

    const user = snap.data();
    const option = document.createElement("option");
    option.value = uid;
    option.textContent = `${user.nombre || user.usuario || "Usuario"} (@${user.usuario || "usuario"})`;
    option.dataset.nombre = user.nombre || user.usuario || "Usuario";
    option.dataset.usuario = user.usuario || "usuario";
    asignado.appendChild(option);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = titulo.value.trim();
  if (!title) {
    alert("Escribe un título para la tarea.");
    return;
  }

  const selected = asignado.selectedOptions[0];
  const assignedUid = asignado.value === "Equipo" ? "" : asignado.value;
  const assignedName = selected?.dataset.nombre || "Equipo";
  const assignedUser = selected?.dataset.usuario || "";

  try {
    await addDoc(collection(db, "tareas"), {
      grupoId,
      titulo: title,
      fechaLimite: fecha.value,
      asignadoA: assignedName,
      asignadoAUsuario: assignedUser,
      asignadoAUid: assignedUid,
      prioridad: prioridad.value,
      descripcion: descripcion.value.trim(),
      estado: "Pendiente",
      creadaPor: me.uid,
      creadaPorUsuario: profile.usuario || "usuario",
      creada: serverTimestamp()
    });

    await addDoc(collection(db, "notificaciones"), {
      grupoId,
      tipo: "tarea",
      titulo: "Nueva tarea",
      texto: `${profile.usuario || "Alguien"} creó: ${title}`,
      creada: serverTimestamp()
    });

    window.location.href = "tareas-grupo.html";
  } catch (error) {
    console.error("Error al crear tarea:", error);
    alert("No se pudo crear la tarea. Revisa tu sesión y permisos de Firestore.");
  }
});
