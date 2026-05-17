import { db } from "./Firebase.js";
import { formatDate, initials, requireAuth } from "./app.js";
import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const list = document.getElementById("notificacionesList");

requireAuth((user) => {
  const groupsQuery = query(collection(db, "grupos"), where("miembros", "array-contains", user.uid));
  onSnapshot(groupsQuery, (groupsSnap) => {
    const groupIds = groupsSnap.docs.map((item) => item.id);
    bindNotifications(groupIds);
  });
});

function bindNotifications(groupIds) {
  onSnapshot(collection(db, "notificaciones"), (snapshot) => {
    const items = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !item.grupoId || groupIds.includes(item.grupoId))
      .sort((a, b) => {
        const aDate = a.creada?.toDate ? a.creada.toDate().getTime() : 0;
        const bDate = b.creada?.toDate ? b.creada.toDate().getTime() : 0;
        return bDate - aDate;
      });

    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = `<div class="emptyState">No tienes notificaciones todavía.</div>`;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "item bordered";
      row.innerHTML = `
        <div class="avatar">${initials(item.titulo || "N")}</div>
        <div><div class="name">${item.titulo || "Notificación"}</div><div class="meta">${item.texto || ""}</div></div>
        <div style="margin-left:auto;" class="meta">${formatDate(item.creada)}</div>
      `;
      list.appendChild(row);
    });
  });
}
