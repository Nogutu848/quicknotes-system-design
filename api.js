"use strict";

// Base URL of the practice API (JSONPlaceholder).
const API_URL = "https://jsonplaceholder.typicode.com/posts";
const MAX_TITLE = 100; // maximum title length

const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");

let busy = false; // true while any request is running

// ---------- UI helpers ----------

function setStatus(message, type = "") {
  statusEl.textContent = message; // textContent only: never innerHTML
  statusEl.className = type;      // "loading", "success" or "error"
}

function setBusy(isBusy) {
  busy = isBusy;
  loadBtn.disabled = isBusy;
  submitBtn.disabled = isBusy;
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.disabled = isBusy;
  });
}

function friendlyError(error) {
  if (error.status) {
    return `The server returned an error (status ${error.status}). Please try again later.`;
  }
  if (error.name === "TypeError") { // fetch rejects with TypeError on network failure
    return "Could not reach the server. Check your internet connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

function removeEmptyState() {
  const empty = notesList.querySelector(".empty");
  if (empty) empty.remove();
}

function showEmptyState() {
  if (notesList.querySelector(".note") || notesList.querySelector(".empty")) return;
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = "No notes to show.";
  notesList.append(li);
}

function createNoteItem(note) {
  const li = document.createElement("li");
  li.className = "note";
  li.dataset.id = note.id;
  if (note.local) li.dataset.local = "true"; // created in this page only

  const title = document.createElement("h3");
  title.textContent = note.title; // user/server text: textContent only

  const body = document.createElement("p");
  body.textContent = note.body || "";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "delete-btn";
  del.textContent = "Delete";
  del.disabled = busy;
  del.setAttribute("aria-label", `Delete note: ${note.title}`);

  li.append(title, body, del);
  return li;
}

function renderNotes(notes) {
  notesList.replaceChildren();
  if (notes.length === 0) {
    showEmptyState();
    return;
  }
  notes.forEach((note) => notesList.append(createNoteItem(note)));
}

// ---------- API layer ----------

// Reusable request helper: calls fetch, checks response.ok, throws on errors.
async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

// GET: load the first 10 notes.
async function getNotes() {
  const { data } = await request(`${API_URL}?_limit=10`);
  return data;
}

// POST: create a note. JSONPlaceholder replies 201 with the note and a new id.
async function createNote({ title, body }) {
  return request(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, userId: 1 }),
  });
}

// DELETE: remove a note by id.
async function deleteNote(id) {
  return request(`${API_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/*
 * JSONPlaceholder is a fake API: it accepts POST and DELETE requests and
 * replies as if they worked, but it never stores any changes. So:
 *  - After a successful DELETE we remove the note from the page ourselves;
 *    the list on screen is our source of truth until the next "Load notes".
 *  - A note we created in this page (id 101) does not exist on the server,
 *    so a DELETE for it may return 404. For those local notes we treat 404
 *    as "already gone" and still remove them from the list.
 *  - Clicking "Load notes" again fetches the original 10 notes, so deleted
 *    notes come back and created notes disappear. A real backend would keep
 *    the changes.
 */
async function deleteOnServer(id, isLocal) {
  try {
    const { status } = await deleteNote(id);
    return status;
  } catch (error) {
    if (isLocal && error.status === 404) return 404;
    throw error;
  }
}

// Returns an error message, or null if the title is valid.
function validateTitle(title) {
  if (title.length === 0) return "Please enter a title.";
  if (title.length > MAX_TITLE) {
    return `The title must be ${MAX_TITLE} characters or fewer (it is ${title.length}).`;
  }
  return null;
}

// ---------- Event handlers ----------

async function handleLoad() {
  if (busy) return;
  setBusy(true);
  setStatus("Loading notes...", "loading");
  try {
    const notes = await getNotes();
    renderNotes(notes);
    setStatus(
      notes.length === 0
        ? "The server returned no notes."
        : `Loaded ${notes.length} notes from the server.`,
      "success"
    );
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}

loadBtn.addEventListener("click", handleLoad);

async function handleSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim(); // body is optional

  const problem = validateTitle(title);
  if (problem) {
    setStatus(problem, "error");
    titleInput.focus();
    return;
  }

  setBusy(true);
  setStatus("Creating note...", "loading");
  try {
    const { status, data } = await createNote({ title, body });
    removeEmptyState();
    notesList.prepend(
      createNoteItem({ id: data.id, title: data.title, body: data.body, local: true })
    );
    noteForm.reset();
    setStatus(`Note created (status ${status}, id ${data.id}).`, "success");
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}

noteForm.addEventListener("submit", handleSubmit);

async function handleDelete(button) {
  const item = button.closest("li.note");
  const id = item.dataset.id;
  const isLocal = item.dataset.local === "true";

  setBusy(true);
  setStatus("Deleting note...", "loading");
  try {
    const status = await deleteOnServer(id, isLocal);
    item.remove();
    showEmptyState(); // does nothing while other notes remain
    setStatus(
      status === 404
        ? `Note ${id} removed (it only existed in this page; the practice server never stored it).`
        : `Note ${id} deleted (status ${status}).`,
      "success"
    );
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
}

// One listener on the list handles every Delete button (event delegation).
notesList.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-btn");
  if (button && !busy) handleDelete(button);
});
