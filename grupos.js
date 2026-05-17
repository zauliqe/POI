import { db } from "./Firebase.js";
import { initials, requireAuth } from "./app.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("grupoForm");
const nombre = document.getElementById("nombreGrupo");
const tipo = document.getElementById("tipoGrupo");
const descripcion = document.getElementById("descripcionGrupo");
const usuariosList = document.getElementById("usuariosList");
const misGrupos = document.getElementById("misGrupos");

let me = null;
let profile = null;
const selectedMembers = new Set();

requireAuth((user, userProfile) => {
  me = user;
  profile = userProfile;
  selectedMembers.add(user.uid);
  bindUsers();
  bindMyGroups();
});

function bindUsers() {
  onSnapshot(collection(db, "usuarios"), (snapshot) => {
    usuariosList.innerHTML = "";
    const users = snapshot.docs
      .filter((item) => item.id !== me.uid)
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => (a.nombre || a.usuario || "").localeCompare(b.nombre || b.usuario || ""));

    if (!users.length) {
      usuariosList.innerHTML = `<div class="emptyState">Cuando tus compañeros se registren, aparecerán aquí.</div>`;
      return;
    }

    users.forEach((user) => {
      const label = document.createElement("label");
      label.className = "checkRow";
      label.innerHTML = `
        <input type="checkbox" value="${user.id}">
        <span class="avatar">${initials(user.nombre || user.usuario)}</span>
        <span>${user.nombre || user.usuario || "Usuario"} <small>@${user.usuario || "usuario"}</small></span>
      `;
      label.querySelector("input").addEventListener("change", (event) => {
        if (event.target.checked) selectedMembers.add(user.id);
        else selectedMembers.delete(user.id);
      });
      usuariosList.appendChild(label);
    });
  }, (error) => {
    console.error("Error al cargar usuarios:", error);
    usuariosList.innerHTML = `<div class="emptyState">No se pudieron cargar los usuarios.</div>`;
  });
}

function bindMyGroups() {
  const q = query(collection(db, "grupos"), where("miembros", "array-contains", me.uid));
  onSnapshot(q, (snapshot) => {
    misGrupos.innerHTML = "";
    if (snapshot.empty) {
      misGrupos.innerHTML = `<div class="emptyState">Aún no has creado grupos.</div>`;
      return;
    }
    snapshot.forEach((item) => {
      const data = item.data();
      const row = document.createElement("a");
      row.className = "item";
      row.href = `dashboard.html?c=${item.id}`;
      row.innerHTML = `
        <div class="avatar">${initials(data.nombre || "Grupo")}</div>
        <div><div class="name">${data.nombre || "Grupo"}</div><div class="meta">${data.miembros?.length || 0} miembros · abrir chat</div></div>
      `;
      misGrupos.appendChild(row);
    });
  }, (error) => {
    console.error("Error al cargar grupos:", error);
    misGrupos.innerHTML = `<div class="emptyState">No se pudieron cargar tus grupos.</div>`;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const groupName = nombre.value.trim();
  if (!groupName) {
    alert("Escribe un nombre para el grupo.");
    return;
  }

  try {
    const groupRef = doc(collection(db, "grupos"));
    const members = Array.from(selectedMembers);
    await setDoc(groupRef, {
      nombre: groupName,
      tipo: tipo.value,
      descripcion: descripcion.value.trim(),
      miembros: members,
      creador: me.uid,
      creado: serverTimestamp()
    });

    await setDoc(doc(db, "conversaciones", groupRef.id), {
      tipo: "grupo",
      nombre: groupName,
      miembros: members,
      creadoPor: profile.usuario || me.uid,
      actualizado: serverTimestamp()
    });

    alert("Grupo creado correctamente.");
    window.location.href = `dashboard.html?c=${groupRef.id}`;
  } catch (error) {
    console.error("Error al crear grupo:", error);
    alert("No se pudo crear el grupo. Revisa tu sesión y permisos de Firestore.");
  }
});
