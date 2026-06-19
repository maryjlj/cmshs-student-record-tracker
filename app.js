const app = document.querySelector("#app");

const state = {
  role: localStorage.getItem("srt_role") || "",
  studentId: localStorage.getItem("srt_student") || "",
  authTab: "student-login",
  teacherView: "overview",
  selectedStudentId: "",
  selectedTerm: "All",
  sections: [],
  recordTypes: [],
  teacher: null,
  student: null,
};

const terms = ["Term 1", "Term 2", "Term 3"];

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

const byId = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

const niceDate = (value) => (value ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "No due date");
const scorePct = (record) => `${Math.round((Number(record.score) / Number(record.maxScore)) * 100)}%`;
const fullName = (student) => `${student.firstName} ${student.lastName}`;
const avatar = (student) => student.profilePhoto
  ? `<img class="avatar" src="${student.profilePhoto}" alt="${esc(fullName(student))} profile photo">`
  : `<div class="avatar placeholder">${esc(student.firstName?.[0] || "S")}</div>`;

function photosMarkup(photos = []) {
  if (!photos.length) return "";
  return `<div class="photo-grid">${photos.map((photo) => `<a href="${photo}" target="_blank" rel="noreferrer"><img src="${photo}" alt="Portfolio upload"></a>`).join("")}</div>`;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Please choose image files only."));
    if (file.size > 1_200_000) return reject(new Error("Each image must be 1.2MB or smaller."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

async function readImages(input, limit = 6) {
  const files = Array.from(input.files || []).slice(0, limit);
  return Promise.all(files.map(readImage));
}

async function init() {
  const options = await api("/api/options");
  state.sections = options.sections;
  state.recordTypes = options.recordTypes;
  if (state.role === "teacher") return loadTeacher();
  if (state.role === "student" && state.studentId) return loadStudent();
  renderAuth();
}

function shell(content) {
  app.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">SR</div>
          <div>
            <h1>Student Record Tracker</h1>
            <p class="muted">Cute class cards, learner records, and teacher approvals.</p>
          </div>
        </div>
        ${state.role ? `<button class="btn secondary" id="logoutBtn">Log out</button>` : ""}
      </header>
      ${content}
    </section>
  `;
  byId("logoutBtn")?.addEventListener("click", logout);
}

function renderAuth(message = "", ok = false) {
  state.role = "";
  state.studentId = "";
  localStorage.removeItem("srt_role");
  localStorage.removeItem("srt_student");
  const sectionOptions = state.sections.map((section) => `<option value="${section}">${section}</option>`).join("");

  shell(`
    <section class="auth-layout">
      <div class="panel hero-panel cute-hero">
        <div class="hero-copy">
          <p class="eyebrow">Learner record workspace</p>
          <h2>Tasks become neat record cards.</h2>
          <p>Teacher creates the activity, chooses the term, then students and teacher can enter scores for approval.</p>
        </div>
        <div class="stat-row">
          <div class="stat"><strong>10</strong><span>Sections</span></div>
          <div class="stat"><strong>3</strong><span>Terms</span></div>
          <div class="stat"><strong>Cards</strong><span>Per task</span></div>
        </div>
      </div>
      <div class="panel auth-card">
        <div class="tabs">
          ${authTab("student-login", "Student Login")}
          ${authTab("register", "Register")}
          ${authTab("teacher-login", "Teacher Login")}
        </div>
        <div id="authBody"></div>
        <p class="message ${ok ? "ok" : ""}" id="authMessage">${esc(message)}</p>
      </div>
    </section>
  `);

  const body = byId("authBody");
  if (state.authTab === "register") {
    body.innerHTML = `
      <form id="registerForm">
        <div class="form-grid">
          <label>First name<input name="firstName" required></label>
          <label>Last name<input name="lastName" required></label>
          <label>Grade and section<select name="gradeSection" required>${sectionOptions}</select></label>
          <label>Active email<input name="email" type="email" required></label>
          <label>Preferred username<input name="username" required></label>
          <label>Password<input name="password" type="password" minlength="6" required></label>
          <label>Repeat password<input name="repeatPassword" type="password" minlength="6" required></label>
        </div>
        <button class="btn" type="submit">Create account</button>
      </form>
    `;
    byId("registerForm").addEventListener("submit", registerStudent);
  } else if (state.authTab === "teacher-login") {
    body.innerHTML = `
      <form id="teacherLoginForm">
        <label>Teacher password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Open teacher dashboard</button>
      </form>
    `;
    byId("teacherLoginForm").addEventListener("submit", loginTeacher);
  } else {
    body.innerHTML = `
      <form id="studentLoginForm">
        <label>Username<input name="username" required></label>
        <label>Password<input name="password" type="password" required></label>
        <button class="btn" type="submit">Open my cards</button>
      </form>
    `;
    byId("studentLoginForm").addEventListener("submit", loginStudent);
  }

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authTab = button.dataset.authTab;
      renderAuth();
    });
  });
}

function authTab(id, label) {
  return `<button class="tab ${state.authTab === id ? "active" : ""}" data-auth-tab="${id}">${label}</button>`;
}

async function registerStudent(event) {
  event.preventDefault();
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.authTab = "student-login";
    renderAuth("Registration successful. You can now log in.", true);
  } catch (error) {
    byId("authMessage").textContent = error.message;
  }
}

async function loginStudent(event) {
  event.preventDefault();
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "student", ...Object.fromEntries(new FormData(event.currentTarget)) }),
    });
    localStorage.setItem("srt_role", "student");
    localStorage.setItem("srt_student", data.student.id);
    state.role = "student";
    state.studentId = data.student.id;
    await loadStudent();
  } catch (error) {
    byId("authMessage").textContent = error.message;
  }
}

async function loginTeacher(event) {
  event.preventDefault();
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", ...Object.fromEntries(new FormData(event.currentTarget)) }),
    });
    localStorage.setItem("srt_role", "teacher");
    state.role = "teacher";
    await loadTeacher();
  } catch (error) {
    byId("authMessage").textContent = error.message;
  }
}

function logout() {
  localStorage.removeItem("srt_role");
  localStorage.removeItem("srt_student");
  state.role = "";
  state.studentId = "";
  state.teacher = null;
  state.student = null;
  renderAuth();
}

async function loadStudent() {
  state.student = await api(`/api/student/${state.studentId}`);
  renderStudent();
}

function renderStudent(message = "", ok = false) {
  const { student, subjects } = state.student;
  const tasks = subjects.flatMap((subject) => subject.tasks.map((task) => ({ ...task, subject })));
  const records = subjects.flatMap((subject) => subject.records);
  const pending = records.filter((record) => record.status === "Pending").length;
  const approved = records.filter((record) => record.status === "Approved").length;
  const visibleTasks = filterByTerm(tasks);

  shell(`
    <div class="summary">
      ${metric("Classes", subjects.length)}
      ${metric("Task Cards", tasks.length)}
      ${metric("Pending", pending)}
      ${metric("Approved", approved)}
    </div>
    <section class="panel profile-banner">
      ${avatar(student)}
      <div>
        <p class="eyebrow">Student space</p>
        <h2>${esc(fullName(student))}</h2>
        <p class="muted">${esc(student.gradeSection)} | ${esc(student.email)} | ${esc(student.username)}</p>
      </div>
      <form id="profilePhotoForm" class="photo-form">
        <label>Profile photo<input name="profilePhoto" type="file" accept="image/*"></label>
        <button class="btn secondary" type="submit">Save photo</button>
      </form>
      ${termFilter()}
    </section>
    <p class="message ${ok ? "ok" : ""}" id="studentMessage">${esc(message)}</p>
    <section class="record-board">
      ${visibleTasks.length ? visibleTasks.map(studentTaskCard).join("") : `<div class="empty wide">No task cards for this term yet. The teacher will create them.</div>`}
    </section>
  `);

  wireTermFilter(() => renderStudent());
  byId("profilePhotoForm")?.addEventListener("submit", saveProfilePhoto);
  document.querySelectorAll("[data-submit-task]").forEach((form) => form.addEventListener("submit", submitTaskScore));
}

function studentTaskCard(task) {
  const record = state.student.subjects
    .flatMap((subject) => subject.records)
    .find((item) => item.taskId === task.id);
  return `
    <article class="task-card ${record ? record.status.toLowerCase() : ""}">
      <div class="task-top">
        <span class="term-pill">${esc(task.term)}</span>
        <span class="badge">${esc(task.type)}</span>
      </div>
      <h3>${esc(task.title)}</h3>
      <p class="muted">${esc(task.subject.name)} | ${esc(task.subject.section)}</p>
      <div class="score-box">
        <span>Max Score</span>
        <strong>${esc(task.maxScore)}</strong>
      </div>
      <p class="muted">Due: ${esc(niceDate(task.dueDate))}</p>
      ${record ? `
        <div class="result-strip">
          <strong>${esc(record.score)}/${esc(record.maxScore)}</strong>
          <span class="badge ${record.status.toLowerCase()}">${esc(record.status)}</span>
          <span>${scorePct(record)}</span>
        </div>
        ${photosMarkup(record.photos)}
      ` : ""}
      <form data-submit-task="${task.id}">
        <input type="hidden" name="taskId" value="${esc(task.id)}">
        <label>Your score<input name="score" type="number" min="0" max="${esc(task.maxScore)}" step="0.01" value="${record ? esc(record.score) : ""}" required></label>
        <label>Portfolio photos<input name="photos" type="file" accept="image/*" multiple></label>
        <button class="btn" type="submit">${record ? "Update score" : "Submit score"}</button>
      </form>
    </article>
  `;
}

async function saveProfilePhoto(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.profilePhoto;
  if (!input.files.length) return;
  try {
    const profilePhoto = await readImage(input.files[0]);
    await api(`/api/students/${state.studentId}`, { method: "PATCH", body: JSON.stringify({ profilePhoto }) });
    await loadStudent();
    renderStudent("Profile photo saved.", true);
  } catch (error) {
    byId("studentMessage").textContent = error.message;
  }
}

async function submitTaskScore(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { studentId: state.studentId, ...Object.fromEntries(new FormData(form)) };
  try {
    body.photos = await readImages(form.elements.photos, 6);
    await api("/api/records", { method: "POST", body: JSON.stringify(body) });
    await loadStudent();
    renderStudent("Saved. Teacher can now approve it.", true);
  } catch (error) {
    byId("studentMessage").textContent = error.message;
  }
}

async function loadTeacher() {
  state.teacher = await api("/api/teacher");
  if (!state.selectedStudentId && state.teacher.students[0]) state.selectedStudentId = state.teacher.students[0].id;
  renderTeacher();
}

function renderTeacher() {
  const data = state.teacher;
  const pending = data.records.filter((record) => record.status === "Pending").length;
  shell(`
    <section class="dashboard">
      <aside class="sidebar panel">
        ${teacherNav("overview", "Overview")}
        ${teacherNav("tasks", "Task Cards")}
        ${teacherNav("students", "Learners")}
        ${teacherNav("classes", "Classes")}
        ${teacherNav("records", "Approvals")}
        ${teacherNav("recovery", "Forgot Password")}
      </aside>
      <div>
        <div class="summary">
          ${metric("Learners", data.students.length)}
          ${metric("Classes", data.subjects.length)}
          ${metric("Tasks", data.tasks.length)}
          ${metric("Pending", pending)}
        </div>
        <div id="teacherBody"></div>
      </div>
    </section>
  `);
  document.querySelectorAll("[data-teacher-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.teacherView = button.dataset.teacherView;
      renderTeacher();
    });
  });
  renderTeacherBody();
}

function teacherNav(id, label) {
  return `<button class="nav-button ${state.teacherView === id ? "active" : ""}" data-teacher-view="${id}">${label}</button>`;
}

function renderTeacherBody() {
  const body = byId("teacherBody");
  if (state.teacherView === "tasks") return renderTasksView(body);
  if (state.teacherView === "students") return renderStudentsView(body);
  if (state.teacherView === "classes") return renderClassesView(body);
  if (state.teacherView === "records") return renderRecordsView(body);
  if (state.teacherView === "recovery") return renderRecoveryView(body);
  return renderOverviewView(body);
}

function renderOverviewView(body) {
  body.innerHTML = `
    <section class="grid two">
      <div class="panel">
        <h2>Recent activity</h2>
        <div class="notice-list">
          ${state.teacher.notifications.slice(0, 8).map((notice) => `
            <div class="notice">
              <strong>${esc(notice.type)}</strong>
              <p>${esc(notice.message)}</p>
            </div>
          `).join("") || `<div class="empty">No notifications yet.</div>`}
        </div>
      </div>
      <div class="panel">
        <h2>Waiting for approval</h2>
        ${recordTable(state.teacher.records.filter((record) => record.status === "Pending"))}
      </div>
    </section>
  `;
  wireRecordButtons();
}

function renderTasksView(body) {
  body.innerHTML = `
    <section class="grid two">
      <div class="panel">
        <h2>Create a task card</h2>
        <form id="taskForm">
          <label>Class<select name="subjectId" required>${state.teacher.subjects.map((subject) => `<option value="${subject.id}">${esc(subject.name)} - ${esc(subject.section)}</option>`).join("")}</select></label>
          <div class="form-grid">
            <label>Term<select name="term">${terms.map((term) => `<option value="${term}">${term}</option>`).join("")}</select></label>
            <label>Record type<select name="type">${state.recordTypes.map((type) => `<option value="${type}">${type}</option>`).join("")}</select></label>
            <label>Card title<input name="title" placeholder="Quiz 1, Activity 2, Exam" required></label>
            <label>Max score<input name="maxScore" type="number" min="1" step="0.01" required></label>
            <label>Due date<input name="dueDate" type="date"></label>
          </div>
          <button class="btn" type="submit">Create card</button>
        </form>
      </div>
      <div class="panel">
        <div class="subject-header">
          <div>
            <h2>Task board</h2>
            <p class="muted">Only cards you create will appear for students.</p>
          </div>
          ${termFilter()}
        </div>
        <div class="record-board compact">
          ${filterByTerm(state.teacher.tasks).length ? filterByTerm(state.teacher.tasks).map(teacherTaskCard).join("") : `<div class="empty wide">No cards for this term.</div>`}
        </div>
      </div>
    </section>
  `;
  byId("taskForm")?.addEventListener("submit", addTask);
  wireTermFilter(() => renderTeacher());
  wireTaskButtons();
}

function teacherTaskCard(task) {
  const subject = state.teacher.subjects.find((item) => item.id === task.subjectId);
  const records = state.teacher.records.filter((record) => record.taskId === task.id);
  return `
    <article class="task-card mini">
      <div class="task-top">
        <span class="term-pill">${esc(task.term)}</span>
        <span class="badge">${records.length} scores</span>
      </div>
      <h3>${esc(task.title)}</h3>
      <p class="muted">${esc(subject?.name || "Class")} | ${esc(task.type)}</p>
      <p>Max score: <strong>${esc(task.maxScore)}</strong></p>
      <button class="btn danger" data-delete-task="${task.id}">Delete card</button>
    </article>
  `;
}

async function addTask(event) {
  event.preventDefault();
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await loadTeacher();
  } catch (error) {
    alert(error.message);
  }
}

function wireTaskButtons() {
  document.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this task card and its scores?")) return;
      await api(`/api/tasks/${button.dataset.deleteTask}`, { method: "DELETE" });
      await loadTeacher();
    });
  });
}

function renderStudentsView(body) {
  const selected = state.teacher.students.find((student) => student.id === state.selectedStudentId) || state.teacher.students[0];
  body.innerHTML = `
    <section class="grid two">
      <div class="panel">
        <h2>Registered learners</h2>
        <div class="learner-list">
          ${state.teacher.students.map((student) => `
            <button class="learner-row ${selected?.id === student.id ? "active" : ""}" data-select-student="${student.id}">
              <span><strong>${esc(fullName(student))}</strong><small>${esc(student.gradeSection)} | ${esc(student.username)}</small></span>
              <span class="badge pending">${student.pendingCount} pending</span>
            </button>
          `).join("") || `<div class="empty">No learners yet.</div>`}
        </div>
      </div>
      <div class="panel">
        ${selected ? studentProfile(selected) : `<div class="empty">Choose a learner.</div>`}
      </div>
    </section>
  `;
  document.querySelectorAll("[data-select-student]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStudentId = button.dataset.selectStudent;
      renderTeacher();
    });
  });
  document.querySelectorAll("[data-teacher-score]").forEach((form) => form.addEventListener("submit", saveTeacherScore));
  wireRecordButtons();
}

function studentProfile(student) {
  const subjects = state.teacher.subjects.filter((subject) => subject.studentIds.includes(student.id));
  const tasks = subjects.flatMap((subject) => state.teacher.tasks.filter((task) => task.subjectId === subject.id).map((task) => ({ ...task, subject })));
  const records = state.teacher.records.filter((record) => record.studentId === student.id);
  return `
    <div class="subject-header">
      ${avatar(student)}
      <div>
        <h2>${esc(fullName(student))}</h2>
        <p class="muted">${esc(student.gradeSection)} | ${esc(student.email)}</p>
      </div>
      <button class="btn danger" data-remove-student="${student.id}">Remove learner</button>
    </div>
    <div class="record-board compact">
      ${tasks.map((task) => learnerTaskCard(student, task, records.find((record) => record.taskId === task.id))).join("") || `<div class="empty wide">No assigned task cards yet.</div>`}
    </div>
  `;
}

function learnerTaskCard(student, task, record) {
  return `
    <article class="task-card mini ${record ? record.status.toLowerCase() : ""}">
      <div class="task-top">
        <span class="term-pill">${esc(task.term)}</span>
        ${record ? `<span class="badge ${record.status.toLowerCase()}">${esc(record.status)}</span>` : `<span class="badge">No score</span>`}
      </div>
      <h3>${esc(task.title)}</h3>
      <p class="muted">${esc(task.subject.name)} | ${esc(task.type)}</p>
      ${record ? `<div class="result-strip"><strong>${esc(record.score)}/${esc(record.maxScore)}</strong><span>${scorePct(record)}</span></div>` : ""}
      ${record ? photosMarkup(record.photos) : ""}
      <form data-teacher-score="${task.id}">
        <input type="hidden" name="studentId" value="${esc(student.id)}">
        <input type="hidden" name="taskId" value="${esc(task.id)}">
        <input type="hidden" name="createdBy" value="teacher">
        <label>Teacher score<input name="score" type="number" min="0" max="${esc(task.maxScore)}" step="0.01" value="${record ? esc(record.score) : ""}" required></label>
        <button class="btn" type="submit">${record ? "Update" : "Add score"}</button>
      </form>
    </article>
  `;
}

async function saveTeacherScore(event) {
  event.preventDefault();
  await api("/api/records", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
  await loadTeacher();
}

function renderClassesView(body) {
  body.innerHTML = `
    <section class="grid two">
      <div class="panel">
        <h2>Add class</h2>
        <form id="subjectForm">
          <label>Subject name<input name="name" required placeholder="Example: TECHDRAFT"></label>
          <label>Section<select name="section">${state.sections.map((section) => `<option value="${section}">${section}</option>`).join("")}</select></label>
          <button class="btn" type="submit">Add class</button>
        </form>
      </div>
      <div class="panel">
        <h2>Assign learner</h2>
        ${assignForm()}
      </div>
    </section>
    <section class="stack class-stack">
      ${state.teacher.subjects.map(classCard).join("") || `<div class="empty">No classes yet.</div>`}
    </section>
  `;
  byId("subjectForm").addEventListener("submit", addSubject);
  byId("assignForm")?.addEventListener("submit", assignStudent);
  wireClassButtons();
}

function assignForm() {
  if (!state.teacher.students.length || !state.teacher.subjects.length) return `<div class="empty">Register a learner and create a class first.</div>`;
  return `
    <form id="assignForm">
      <label>Learner<select name="studentId">${state.teacher.students.map((student) => `<option value="${student.id}">${esc(fullName(student))} (${esc(student.gradeSection)})</option>`).join("")}</select></label>
      <label>Class<select name="subjectId">${state.teacher.subjects.map((subject) => `<option value="${subject.id}">${esc(subject.name)} - ${esc(subject.section)}</option>`).join("")}</select></label>
      <button class="btn" type="submit">Assign</button>
    </form>
  `;
}

function classCard(subject) {
  return `
    <article class="panel class-card">
      <div class="subject-header">
        <div>
          <h2>${esc(subject.name)}</h2>
          <p class="muted">${esc(subject.section)} | ${subject.students.length} learners</p>
        </div>
        <button class="btn danger" data-delete-subject="${subject.id}">Delete class</button>
      </div>
      <div class="learner-chips">
        ${subject.students.map((student) => `<span>${esc(fullName(student))}<button data-unassign="${subject.id}:${student.id}" title="Remove">x</button></span>`).join("") || `<div class="empty">No learners assigned.</div>`}
      </div>
    </article>
  `;
}

async function addSubject(event) {
  event.preventDefault();
  await api("/api/subjects", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
  await loadTeacher();
}

async function assignStudent(event) {
  event.preventDefault();
  await api("/api/assign", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
  await loadTeacher();
}

function wireClassButtons() {
  document.querySelectorAll("[data-delete-subject]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this class, cards, and records?")) return;
      await api(`/api/subjects/${button.dataset.deleteSubject}`, { method: "DELETE" });
      await loadTeacher();
    });
  });
  document.querySelectorAll("[data-unassign]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [subjectId, studentId] = button.dataset.unassign.split(":");
      await api("/api/unassign", { method: "POST", body: JSON.stringify({ subjectId, studentId }) });
      await loadTeacher();
    });
  });
  document.querySelectorAll("[data-remove-student]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Remove this learner and all records?")) return;
      await api(`/api/students/${button.dataset.removeStudent}`, { method: "DELETE" });
      state.selectedStudentId = "";
      await loadTeacher();
    });
  });
}

function renderRecordsView(body) {
  body.innerHTML = `
    <section class="panel">
      <div class="subject-header">
        <div>
          <h2>Approvals</h2>
          <p class="muted">Review submitted scores, approve them, edit them, or remove them.</p>
        </div>
        ${termFilter()}
      </div>
      ${recordTable(filterByTerm(state.teacher.records))}
    </section>
  `;
  wireTermFilter(() => renderTeacher());
  wireRecordButtons();
}

function recordTable(records) {
  if (!records.length) return `<div class="empty">No records to show.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Learner</th><th>Class</th><th>Term</th><th>Task</th><th>Score</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${records.map((record) => {
            const student = state.teacher.students.find((item) => item.id === record.studentId);
            const subject = state.teacher.subjects.find((item) => item.id === record.subjectId);
            return `
              <tr>
                <td>${student ? esc(fullName(student)) : "Learner"}</td>
                <td>${subject ? esc(subject.name) : "Class"}</td>
                <td><span class="term-pill small">${esc(record.term || "Term 1")}</span></td>
                <td>${esc(record.title)}<br><span class="muted">${esc(record.type)}</span>${photosMarkup(record.photos)}</td>
                <td><strong>${esc(record.score)}/${esc(record.maxScore)}</strong><br><span class="muted">${scorePct(record)}</span></td>
                <td><span class="badge ${record.status.toLowerCase()}">${esc(record.status)}</span></td>
                <td class="actions">
                  ${record.status === "Pending" ? `<button class="btn" data-approve-record="${record.id}">Approve</button>` : ""}
                  <button class="btn secondary" data-edit-record="${record.id}">Edit</button>
                  <button class="btn danger" data-delete-record="${record.id}">Remove</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function wireRecordButtons() {
  document.querySelectorAll("[data-approve-record]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/records/${button.dataset.approveRecord}`, { method: "PATCH", body: JSON.stringify({ status: "Approved" }) });
      await loadTeacher();
    });
  });
  document.querySelectorAll("[data-delete-record]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Remove this record?")) return;
      await api(`/api/records/${button.dataset.deleteRecord}`, { method: "DELETE" });
      await loadTeacher();
    });
  });
  document.querySelectorAll("[data-edit-record]").forEach((button) => {
    button.addEventListener("click", async () => {
      const record = state.teacher.records.find((item) => item.id === button.dataset.editRecord);
      const score = prompt("Score:", record.score);
      if (score === null) return;
      const maxScore = prompt("Maximum score:", record.maxScore);
      if (maxScore === null) return;
      await api(`/api/records/${record.id}`, { method: "PATCH", body: JSON.stringify({ score, maxScore }) });
      await loadTeacher();
    });
  });
  document.querySelectorAll("[data-remove-student]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Remove this learner and all records?")) return;
      await api(`/api/students/${button.dataset.removeStudent}`, { method: "DELETE" });
      state.selectedStudentId = "";
      await loadTeacher();
    });
  });
}

function renderRecoveryView(body) {
  body.innerHTML = `
    <section class="panel">
      <h2>Forgot username or password</h2>
      <p class="muted">Find the learner account, then open a ready-made email draft.</p>
      <form id="forgotForm">
        <div class="form-grid">
          <label>Email<input name="email" type="email" placeholder="student@email.com"></label>
          <label>Username<input name="username" placeholder="optional"></label>
        </div>
        <button class="btn" type="submit">Find account</button>
      </form>
      <div id="recoveryResult"></div>
    </section>
  `;
  byId("forgotForm").addEventListener("submit", recoverAccount);
}

async function recoverAccount(event) {
  event.preventDefault();
  const result = byId("recoveryResult");
  try {
    const data = await api("/api/forgot", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    result.innerHTML = `
      <div class="card recovery-card">
        <h3>${esc(fullName(data.student))}</h3>
        <p class="muted">${esc(data.student.email)}</p>
        <p><strong>Username:</strong> ${esc(data.recovery.username)}</p>
        <p><strong>Password:</strong> ${esc(data.recovery.password)}</p>
        <a class="btn" href="${data.mailto}">Open email draft</a>
      </div>
    `;
  } catch (error) {
    result.innerHTML = `<p class="message">${esc(error.message)}</p>`;
  }
}

function metric(label, value) {
  return `<div class="metric"><strong>${esc(value)}</strong><span class="muted">${label}</span></div>`;
}

function termFilter() {
  return `
    <div class="segmented">
      ${["All", ...terms].map((term) => `<button class="chip ${state.selectedTerm === term ? "active" : ""}" data-term="${term}">${term}</button>`).join("")}
    </div>
  `;
}

function wireTermFilter(render) {
  document.querySelectorAll("[data-term]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTerm = button.dataset.term;
      render();
    });
  });
}

function filterByTerm(items) {
  if (state.selectedTerm === "All") return items;
  return items.filter((item) => item.term === state.selectedTerm);
}

init().catch((error) => {
  app.innerHTML = `<section class="shell"><div class="panel"><h1>Student Record Tracker</h1><p class="message">${esc(error.message)}</p></div></section>`;
});
