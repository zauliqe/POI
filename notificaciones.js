import { db } from "./Firebase.js";
import { formatDate, initials, requireAuth } from "./app.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const list = document.getElementById("notificacionesList");
const count = document.getElementById("notificacionesCount");
let unsubscribeNotifications = null;

requireAuth((user) => {
  const groupsQuery = query(collection(db, "grupos"), where("miembros", "array-contains", user.uid));

  onSnapshot(groupsQuery, (groupsSnap) => {
    const groupIds = groupsSnap.docs.map((item) => item.id);
    bindNotifications(groupIds);
  });
});

function bindNotifications(groupIds) {
  if (unsubscribeNotifications) unsubscribeNotifications();

  unsubscribeNotifications = onSnapshot(collection(db, "notificaciones"), (snapshot) => {
    const items = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !item.grupoId || groupIds.includes(item.grupoId))
      .sort((a, b) => {
        const aDate = a.creada?.toDate ? a.creada.toDate().getTime() : 0;
        const bDate = b.creada?.toDate ? b.creada.toDate().getTime() : 0;
        return bDate - aDate;
      });

    if (count) count.textContent = `${items.length} ${items.length === 1 ? "aviso" : "avisos"}`;
    list.innerHTML = "";

    if (!items.length) {
      list.innerHTML = `
        <div class="emptyState">
          No tienes notificaciones todavia.
          <div class="meta" style="margin-top:8px;">Cuando creen o completen tareas en tus grupos apareceran aqui.</div>
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "notificationItem";
      row.innerHTML = `
        <div class="avatar notificationAvatar">${initials(item.titulo || "N")}</div>
        <div class="notificationBody">
          <div class="name">${escapeHtml(item.titulo || "Notificacion")}</div>
          <div class="meta">${escapeHtml(item.texto || "")}</div>
        </div>
        <div class="meta notificationDate">${formatDate(item.creada)}</div>
      `;
      list.appendChild(row);
    });
  }, (error) => {
    console.error("Error al cargar notificaciones:", error);
    list.innerHTML = `<div class="emptyState">No se pudieron cargar las notificaciones.</div>`;
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
