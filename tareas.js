import { db } from "./Firebase.js";
import { formatDate, requireAuth } from "./app.js";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const tareasList = document.getElementById("tareasList");
const grupoSelect = document.getElementById("grupoFiltro");
const nuevaTarea = document.getElementById("nuevaTarea");
const verAgenda = document.getElementById("verAgenda");

let me = null;
let profile = null;
let activeGroup = localStorage.getItem("grupoActivo") || "";
let stopTasks = null;

// Obtener puntos según prioridad (misiones)
function puntosPorPrioridad(prioridad) {
  switch (prioridad) {
    case "Alta": return 20;
    case "Media": return 10;
    case "Baja": return 5;
    default: return 10;
  }
}

requireAuth(async (user, userProfile) => {
  me = user;
  profile = userProfile;
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
      if (verAgenda) verAgenda.style.display = "none";
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
    if (verAgenda) verAgenda.href = `agenda.html?g=${activeGroup}`;
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
      const completada = task.estado === "Completada";
      const puntos = puntosPorPrioridad(task.prioridad || "Media");
      
      const card = document.createElement("article");
      card.className = "card pad";
      card.innerHTML = `
        <div class="pill">${task.estado || "Pendiente"} · ${task.prioridad || "Media"} · +${puntos} pts</div>
        <h2 class="h2" style="margin-top:10px;">${task.titulo || "Tarea"}</h2>
        <p class="p">${task.descripcion || "Sin descripción"}</p>
        <p class="p">📅 Entrega: ${task.fechaLimite || "Sin fecha"} · 👤 Asignado a: ${task.asignadoA || "Equipo"}</p>
        <p class="p">✍️ Creada: ${formatDate(task.creada)}</p>
        ${completada ? `<p class="p">✅ Completada por: ${task.completadaPor || "alguien"}</p>` : ""}
        <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
          ${!completada ? `<button class="btn small primary" data-action="done">✓ Marcar hecho (+${puntos} pts)</button>` : ""}
          <button class="btn small danger" data-action="delete">🗑️ Eliminar</button>
        </div>
      `;
      
      if (!completada) {
        const doneBtn = card.querySelector('[data-action="done"]');
        doneBtn.addEventListener("click", async () => {
          if (task.estado === "Completada") {
            alert("Esta tarea ya fue completada.");
            return;
          }
          
          // Verificar que el usuario pertenece al grupo (seguridad básica)
          const grupoRef = doc(db, "grupos", groupId);
          const grupoSnap = await getDoc(grupoRef);
          if (!grupoSnap.exists() || !grupoSnap.data().miembros.includes(me.uid)) {
            alert("No eres miembro de este grupo.");
            return;
          }
          
          // Evitar otorgar puntos dos veces
          if (task.puntosOtorgados) {
            alert("Esta tarea ya otorgó puntos anteriormente.");
            await updateDoc(doc(db, "tareas", task.id), { estado: "Completada" });
            location.reload();
            return;
          }
          
          // Otorgar puntos al usuario actual
          const userRef = doc(db, "usuarios", me.uid);
          const userSnap = await getDoc(userRef);
          const puntosActuales = userSnap.data()?.puntos || 0;
          const puntosGanados = puntos;
          
          await updateDoc(userRef, { puntos: puntosActuales + puntosGanados });
          
          // Marcar tarea como completada y guardar quién la completó
          await updateDoc(doc(db, "tareas", task.id), {
            estado: "Completada",
            completadaPor: profile.usuario || me.uid,
            completadaEn: new Date().toISOString(),
            puntosOtorgados: true
          });
          
          // Notificación al grupo
          await addNotification(groupId, `✅ ${profile.usuario || "Alguien"} completó la tarea: ${task.titulo} (+${puntosGanados} pts)`);
          
          alert(`¡Completaste la tarea! Ganaste ${puntosGanados} puntos.`);
          // Recargar la lista para que el botón desaparezca
          bindTasks(groupId);
        });
      }
      
      const deleteBtn = card.querySelector('[data-action="delete"]');
      deleteBtn.addEventListener("click", async () => {
        if (confirm("¿Eliminar esta tarea permanentemente?")) {
          await deleteDoc(doc(db, "tareas", task.id));
        }
      });
      
      tareasList.appendChild(card);
    });
  });
}

// Función auxiliar para crear notificaciones
async function addNotification(grupoId, texto) {
  const { addDoc, collection, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await addDoc(collection(db, "notificaciones"), {
    grupoId,
    tipo: "tarea",
    titulo: "Tarea completada",
    texto,
    creada: serverTimestamp()
  });
}

grupoSelect.addEventListener("change", () => {
  activeGroup = grupoSelect.value;
  localStorage.setItem("grupoActivo", activeGroup);
  nuevaTarea.href = `crear-tarea.html?g=${activeGroup}`;
  if (verAgenda) verAgenda.href = `agenda.html?g=${activeGroup}`;
  bindTasks(activeGroup);
});