import { db } from "./Firebase.js";
import { formatDate, requireAuth } from "./app.js";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const tareasList = document.getElementById("tareasList");
const grupoSelect = document.getElementById("grupoFiltro");
const nuevaTarea = document.getElementById("nuevaTarea");

let me = null;
let activeGroup = localStorage.getItem("grupoActivo") || "";
let stopTasks = null;

requireAuth((user) => {
  me = user;
  bindGroups();
});

function bindGroups() {
  const groupsQuery = query(collection(db, "grupos"), where("miembros", "array-contains", me.uid));
  onSnapshot(groupsQuery, (snapshot) => {
    grupoSelect.innerHTML = "";
    if (snapshot.empty) {
      grupoSelect.innerHTML = `<option value="">Sin grupos</option>`;
      tareasList.innerHTML = `<div class="emptyState">Primero crea un grupo para asignar tareas.</div>`;
      nuevaTarea.classList.add("disabled");
      return;
    }

    snapshot.forEach((item) => {
      const group = item.data();
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = group.nombre || "Grupo";
      grupoSelect.appendChild(option);
    });

    if (!activeGroup || !snapshot.docs.some((item) => item.id === activeGroup)) {
      activeGroup = snapshot.docs[0].id;
    }
    grupoSelect.value = activeGroup;
    nuevaTarea.href = `crear-tarea.html?g=${activeGroup}`;
    localStorage.setItem("grupoActivo", activeGroup);
    bindTasks(activeGroup);
  });
}

function bindTasks(groupId) {
  if (stopTasks) stopTasks();
  const tasksQuery = query(collection(db, "tareas"), where("grupoId", "==", groupId));
  stopTasks = onSnapshot(tasksQuery, (snapshot) => {
    tareasList.innerHTML = "";
    if (snapshot.empty) {
      tareasList.innerHTML = `<div class="emptyState">Este grupo todavía no tiene tareas.</div>`;
      return;
    }

    const tasks = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => {
        const aDate = a.creada?.toDate ? a.creada.toDate().getTime() : 0;
        const bDate = b.creada?.toDate ? b.creada.toDate().getTime() : 0;
        return bDate - aDate;
      });

    tasks.forEach((task) => {
      const card = document.createElement("article");
      card.className = "card pad";
      card.innerHTML = `
        <div class="pill">${task.estado || "Pendiente"} · ${task.prioridad || "Media"}</div>
        <h2 class="h2" style="margin-top:10px;">${task.titulo || "Tarea"}</h2>
        <p class="p">${task.descripcion || "Sin descripción"}</p>
        <p class="p">Entrega: ${task.fechaLimite || "Sin fecha"} · Asignado a: ${task.asignadoA || "Equipo"}</p>
        <p class="p">Creada: ${formatDate(task.creada)}</p>
        <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
          <button class="btn small primary" data-action="done">Marcar hecho</button>
          <button class="btn small danger" data-action="delete">Eliminar</button>
        </div>
      `;
      card.querySelector('[data-action="done"]').addEventListener("click", () => {
        updateDoc(doc(db, "tareas", task.id), { estado: "Completada" });
      });
      card.querySelector('[data-action="delete"]').addEventListener("click", () => {
        deleteDoc(doc(db, "tareas", task.id));
      });
      tareasList.appendChild(card);
    });
  });
}

grupoSelect.addEventListener("change", () => {
  activeGroup = grupoSelect.value;
  localStorage.setItem("grupoActivo", activeGroup);
  nuevaTarea.href = `crear-tarea.html?g=${activeGroup}`;
  bindTasks(activeGroup);
});
