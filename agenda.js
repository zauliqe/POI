import { db } from "./Firebase.js";
import { requireAuth, formatDate } from "./app.js";
import {
  collection,
  onSnapshot,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentDate = new Date();
let currentGroupId = localStorage.getItem("grupoActivo") || "";
let userUid = null;
let allTasks = []; // cache de tareas del grupo actual

const calendarGrid = document.getElementById("calendarGrid");
const monthYearSpan = document.getElementById("monthYear");
const prevBtn = document.getElementById("prevMonth");
const nextBtn = document.getElementById("nextMonth");
const grupoFiltro = document.getElementById("grupoFiltroAgenda");
const tasksForDayDiv = document.getElementById("tasksForDay");

requireAuth(async (user) => {
  userUid = user.uid;
  await loadGroups();
  await loadTasksForGroup(currentGroupId);
  renderCalendar();
  listenTasksChanges();
});

async function loadGroups() {
  const q = query(collection(db, "grupos"), where("miembros", "array-contains", userUid));
  const snapshot = await getDocs(q);
  grupoFiltro.innerHTML = "";
  if (snapshot.empty) {
    grupoFiltro.innerHTML = `<option value="">Sin grupos</option>`;
    return;
  }
  snapshot.forEach(doc => {
    const group = doc.data();
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = group.nombre || "Grupo";
    if (doc.id === currentGroupId) option.selected = true;
    grupoFiltro.appendChild(option);
  });
  if (!currentGroupId || !snapshot.docs.some(d => d.id === currentGroupId)) {
    currentGroupId = snapshot.docs[0]?.id || "";
    grupoFiltro.value = currentGroupId;
  }
}

function listenTasksChanges() {
  if (!currentGroupId) return;
  const q = query(collection(db, "tareas"), where("grupoId", "==", currentGroupId));
  onSnapshot(q, (snapshot) => {
    allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderCalendar();
    // Si hay un día seleccionado, volver a mostrar tareas
    const activeDay = document.querySelector(".cal-day.active");
    if (activeDay && activeDay.dataset.date) {
      showTasksForDate(activeDay.dataset.date);
    } else {
      tasksForDayDiv.innerHTML = `<div class="emptyState">Selecciona un día en el calendario.</div>`;
    }
  });
}

async function loadTasksForGroup(groupId) {
  if (!groupId) return;
  const q = query(collection(db, "tareas"), where("grupoId", "==", groupId));
  const snapshot = await getDocs(q);
  allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderCalendar();
}

grupoFiltro.addEventListener("change", (e) => {
  currentGroupId = e.target.value;
  localStorage.setItem("grupoActivo", currentGroupId);
  loadTasksForGroup(currentGroupId);
});

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startWeekday = firstDayOfMonth.getDay(); // 0 domingo, ajustar a lunes? usamos domingo como 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  monthYearSpan.textContent = `${firstDayOfMonth.toLocaleString("es-MX", { month: "long", year: "numeric" })}`;
  
  // Construir cabeceras de días
  let gridHTML = `<div class="cal-header">Dom</div><div class="cal-header">Lun</div><div class="cal-header">Mar</div><div class="cal-header">Mié</div><div class="cal-header">Jue</div><div class="cal-header">Vie</div><div class="cal-header">Sáb</div>`;
  
  // Celdas vacías antes del día 1
  let dayCounter = 1;
  for (let i = 0; i < 42; i++) {
    if (i < startWeekday || dayCounter > daysInMonth) {
      gridHTML += `<div class="cal-day" style="opacity:0.3;"></div>`;
    } else {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(dayCounter).padStart(2,'0')}`;
      const hasTask = allTasks.some(t => t.fechaLimite === dateStr && t.estado !== "Completada");
      const activeClass = (document.querySelector(".cal-day.active")?.dataset.date === dateStr) ? "active" : "";
      gridHTML += `
        <div class="cal-day ${hasTask ? 'has-tasks' : ''} ${activeClass}" data-date="${dateStr}">
          <div class="day-number">${dayCounter}</div>
          ${hasTask ? `<div class="task-badge">📋 tarea</div>` : ""}
        </div>
      `;
      dayCounter++;
    }
  }
  
  calendarGrid.innerHTML = gridHTML;
  
  // Añadir eventos click a los días
  document.querySelectorAll(".cal-day[data-date]").forEach(dayDiv => {
    dayDiv.addEventListener("click", () => {
      document.querySelectorAll(".cal-day").forEach(d => d.classList.remove("active"));
      dayDiv.classList.add("active");
      showTasksForDate(dayDiv.dataset.date);
    });
  });
}

function showTasksForDate(date) {
  const tasksForDate = allTasks.filter(t => t.fechaLimite === date);
  if (tasksForDate.length === 0) {
    tasksForDayDiv.innerHTML = `<div class="emptyState">No hay tareas programadas para este día.</div>`;
    return;
  }
  
  tasksForDayDiv.innerHTML = "";
  tasksForDate.forEach(task => {
    const taskCard = document.createElement("div");
    taskCard.className = "card pad";
    taskCard.style.marginBottom = "12px";
    taskCard.innerHTML = `
      <div class="pill">${task.estado || "Pendiente"} · ${task.prioridad || "Media"}</div>
      <h3 class="h2" style="margin-top:8px;">${task.titulo}</h3>
      <p class="p">${task.descripcion || "Sin descripción"}</p>
      <p class="p">👤 Asignado: ${task.asignadoA || "Equipo"} · ${task.fechaLimite}</p>
      <a class="btn small" href="tareas-grupo.html">Ir a tareas →</a>
    `;
    tasksForDayDiv.appendChild(taskCard);
  });
}

prevBtn.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
});

nextBtn.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
});