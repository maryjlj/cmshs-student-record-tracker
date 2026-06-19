const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const sections = [
  "11-ALS",
  "11-CBT",
  "11-FCS",
  "11-BE",
  "11-ASSH",
  "12-ALS",
  "12-ICT",
  "12-ABM",
  "12-HE",
  "12-HUMSS",
];

const recordTypes = [
  "Written Works",
  "Performance Task",
  "1st Summative Exam",
  "2nd Summative Exam",
  "Periodical Exam",
];

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({
      students: [],
      subjects: [
        { id: id(), name: "English", section: "11-ALS", studentIds: [] },
        { id: id(), name: "Mathematics", section: "11-CBT", studentIds: [] },
      ],
      tasks: [],
      records: [],
      notifications: [],
    });
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  let changed = false;
  if (!Array.isArray(db.tasks)) {
    db.tasks = [];
    changed = true;
  }
  db.records.forEach((record) => {
    if (!record.term) {
      record.term = "Term 1";
      changed = true;
    }
    if (!Array.isArray(record.photos)) {
      record.photos = [];
      changed = true;
    }
  });
  db.students.forEach((student) => {
    if (student.profilePhoto === undefined) {
      student.profilePhoto = "";
      changed = true;
    }
  });
  if (changed) writeDb(db);
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(8).toString("hex");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12_000_000) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function publicStudent(student) {
  const { password, ...safe } = student;
  return safe;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) return `Missing: ${missing.join(", ")}`;
  return "";
}

function findStudent(db, studentId) {
  return db.students.find((student) => student.id === studentId);
}

function studentPayload(db, studentId) {
  const student = findStudent(db, studentId);
  if (!student) return null;
  const subjects = db.subjects
    .filter((subject) => subject.studentIds.includes(studentId))
    .map((subject) => ({
      ...subject,
      tasks: db.tasks.filter((task) => task.subjectId === subject.id),
      records: db.records.filter(
        (record) => record.studentId === studentId && record.subjectId === subject.id,
      ),
    }));
  return { student: publicStudent(student), subjects, recordTypes };
}

function teacherPayload(db) {
  const students = db.students.map((student) => ({
    ...publicStudent(student),
    subjectCount: db.subjects.filter((subject) => subject.studentIds.includes(student.id)).length,
    pendingCount: db.records.filter(
      (record) => record.studentId === student.id && record.status === "Pending",
    ).length,
  }));

  const subjects = db.subjects.map((subject) => ({
    ...subject,
    students: subject.studentIds
      .map((studentId) => findStudent(db, studentId))
      .filter(Boolean)
      .map(publicStudent),
    records: db.records.filter((record) => record.subjectId === subject.id),
  }));

  return {
    students,
    subjects,
    tasks: db.tasks,
    records: db.records,
    notifications: db.notifications.slice().reverse(),
    sections,
    recordTypes,
  };
}

async function api(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = readDb();

  try {
    if (req.method === "GET" && url.pathname === "/api/options") {
      return sendJson(res, 200, { sections, recordTypes });
    }

    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readBody(req);
      const missing = requireFields(body, [
        "firstName",
        "lastName",
        "gradeSection",
        "email",
        "username",
        "password",
        "repeatPassword",
      ]);
      if (missing) return sendJson(res, 400, { error: missing });
      if (!sections.includes(body.gradeSection)) return sendJson(res, 400, { error: "Choose a valid grade and section." });
      if (body.password !== body.repeatPassword) return sendJson(res, 400, { error: "Passwords do not match." });
      if (body.password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return sendJson(res, 400, { error: "Enter a valid active email address." });
      if (db.students.some((student) => student.username.toLowerCase() === body.username.toLowerCase())) {
        return sendJson(res, 409, { error: "Username is already taken." });
      }
      if (db.students.some((student) => student.email.toLowerCase() === body.email.toLowerCase())) {
        return sendJson(res, 409, { error: "Email address is already registered." });
      }

      const student = {
        id: id(),
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        gradeSection: body.gradeSection,
        email: body.email.trim(),
        username: body.username.trim(),
        password: body.password,
        profilePhoto: "",
        createdAt: new Date().toISOString(),
      };
      db.students.push(student);
      db.notifications.push({
        id: id(),
        type: "Registration",
        message: `${student.firstName} ${student.lastName} registered and is waiting for class assignment.`,
        createdAt: new Date().toISOString(),
      });
      writeDb(db);
      return sendJson(res, 201, { student: publicStudent(student) });
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      if (body.role === "teacher") {
        if (body.password === "teacher123") return sendJson(res, 200, { role: "teacher" });
        return sendJson(res, 401, { error: "Incorrect teacher password." });
      }
      const student = db.students.find(
        (item) => item.username === body.username && item.password === body.password,
      );
      if (!student) return sendJson(res, 401, { error: "Incorrect username or password." });
      return sendJson(res, 200, { role: "student", student: publicStudent(student) });
    }

    if (req.method === "GET" && url.pathname === "/api/teacher") {
      return sendJson(res, 200, teacherPayload(db));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/student/")) {
      const studentId = url.pathname.split("/").pop();
      const payload = studentPayload(db, studentId);
      if (!payload) return sendJson(res, 404, { error: "Student not found." });
      return sendJson(res, 200, payload);
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/students/")) {
      const studentId = url.pathname.split("/").pop();
      const body = await readBody(req);
      const student = findStudent(db, studentId);
      if (!student) return sendJson(res, 404, { error: "Student not found." });
      if (body.profilePhoto !== undefined) {
        const photo = String(body.profilePhoto || "");
        if (photo && !photo.startsWith("data:image/")) return sendJson(res, 400, { error: "Upload image files only." });
        student.profilePhoto = photo;
      }
      writeDb(db);
      return sendJson(res, 200, { student: publicStudent(student) });
    }

    if (req.method === "POST" && url.pathname === "/api/subjects") {
      const body = await readBody(req);
      const missing = requireFields(body, ["name", "section"]);
      if (missing) return sendJson(res, 400, { error: missing });
      if (!sections.includes(body.section)) return sendJson(res, 400, { error: "Choose a valid section." });
      const subject = { id: id(), name: body.name.trim(), section: body.section, studentIds: [] };
      db.subjects.push(subject);
      writeDb(db);
      return sendJson(res, 201, { subject });
    }

    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readBody(req);
      const missing = requireFields(body, ["subjectId", "term", "type", "title", "maxScore"]);
      if (missing) return sendJson(res, 400, { error: missing });
      const subject = db.subjects.find((item) => item.id === body.subjectId);
      if (!subject) return sendJson(res, 404, { error: "Class not found." });
      if (!["Term 1", "Term 2", "Term 3"].includes(body.term)) return sendJson(res, 400, { error: "Choose Term 1, Term 2, or Term 3." });
      if (!recordTypes.includes(body.type)) return sendJson(res, 400, { error: "Choose a valid record type." });
      const maxScore = Number(body.maxScore);
      if (!Number.isFinite(maxScore) || maxScore <= 0) return sendJson(res, 400, { error: "Maximum score must be greater than 0." });
      const task = {
        id: id(),
        subjectId: subject.id,
        term: body.term,
        type: body.type,
        title: body.title.trim(),
        maxScore,
        dueDate: String(body.dueDate || "").trim(),
        createdAt: new Date().toISOString(),
      };
      db.tasks.push(task);
      db.notifications.push({
        id: id(),
        type: "Task Created",
        message: `${task.title} was assigned to ${subject.name} (${subject.section}) for ${task.term}.`,
        createdAt: new Date().toISOString(),
      });
      writeDb(db);
      return sendJson(res, 201, { task });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/tasks/")) {
      const taskId = url.pathname.split("/").pop();
      db.tasks = db.tasks.filter((task) => task.id !== taskId);
      db.records = db.records.filter((record) => record.taskId !== taskId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/subjects/")) {
      const subjectId = url.pathname.split("/").pop();
      db.subjects = db.subjects.filter((subject) => subject.id !== subjectId);
      db.tasks = db.tasks.filter((task) => task.subjectId !== subjectId);
      db.records = db.records.filter((record) => record.subjectId !== subjectId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/assign") {
      const body = await readBody(req);
      const subject = db.subjects.find((item) => item.id === body.subjectId);
      const student = findStudent(db, body.studentId);
      if (!subject || !student) return sendJson(res, 404, { error: "Subject or student not found." });
      if (!subject.studentIds.includes(student.id)) subject.studentIds.push(student.id);
      writeDb(db);
      return sendJson(res, 200, { subject });
    }

    if (req.method === "POST" && url.pathname === "/api/unassign") {
      const body = await readBody(req);
      const subject = db.subjects.find((item) => item.id === body.subjectId);
      if (!subject) return sendJson(res, 404, { error: "Subject not found." });
      subject.studentIds = subject.studentIds.filter((studentId) => studentId !== body.studentId);
      db.records = db.records.filter(
        (record) => !(record.subjectId === body.subjectId && record.studentId === body.studentId),
      );
      writeDb(db);
      return sendJson(res, 200, { subject });
    }

    if (req.method === "POST" && url.pathname === "/api/records") {
      const body = await readBody(req);
      const missing = requireFields(body, ["studentId", "score"]);
      if (missing) return sendJson(res, 400, { error: missing });
      const task = body.taskId ? db.tasks.find((item) => item.id === body.taskId) : null;
      const subjectId = task ? task.subjectId : body.subjectId;
      const subject = db.subjects.find((item) => item.id === subjectId);
      const student = findStudent(db, body.studentId);
      if (!subject || !student || !subject.studentIds.includes(student.id)) {
        return sendJson(res, 403, { error: "Student is not enrolled in this subject." });
      }
      const type = task ? task.type : body.type;
      const title = task ? task.title : body.title;
      const term = task ? task.term : body.term;
      const maxScoreValue = task ? task.maxScore : body.maxScore;
      if (!title) return sendJson(res, 400, { error: "Missing task or activity name." });
      if (!["Term 1", "Term 2", "Term 3"].includes(term)) return sendJson(res, 400, { error: "Choose Term 1, Term 2, or Term 3." });
      if (!recordTypes.includes(type)) return sendJson(res, 400, { error: "Choose a valid record type." });
      const score = Number(body.score);
      const maxScore = Number(maxScoreValue);
      if (!Number.isFinite(score) || !Number.isFinite(maxScore) || score < 0 || maxScore <= 0 || score > maxScore) {
        return sendJson(res, 400, { error: "Score must be between 0 and the maximum score." });
      }
      const existing = task
        ? db.records.find((record) => record.taskId === task.id && record.studentId === student.id)
        : null;
      if (existing) {
        existing.score = score;
        existing.maxScore = maxScore;
        existing.status = body.createdBy === "teacher" ? "Approved" : "Pending";
        if (Array.isArray(body.photos) && body.photos.length) {
          existing.photos = body.photos.filter((photo) => String(photo).startsWith("data:image/")).slice(0, 6);
        }
        existing.updatedAt = new Date().toISOString();
        writeDb(db);
        return sendJson(res, 200, { record: existing });
      }
      const record = {
        id: id(),
        studentId: student.id,
        subjectId: subject.id,
        taskId: task ? task.id : "",
        term,
        type,
        title: String(title).trim(),
        score,
        maxScore,
        status: body.createdBy === "teacher" ? "Approved" : "Pending",
        note: "",
        createdBy: body.createdBy === "teacher" ? "teacher" : "student",
        photos: Array.isArray(body.photos) ? body.photos.filter((photo) => String(photo).startsWith("data:image/")).slice(0, 6) : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      db.records.push(record);
      db.notifications.push({
        id: id(),
        type: "Record Submitted",
        message: `${student.firstName} ${student.lastName} submitted ${record.title} in ${subject.name}.`,
        createdAt: new Date().toISOString(),
      });
      writeDb(db);
      return sendJson(res, 201, { record });
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/records/")) {
      const recordId = url.pathname.split("/").pop();
      const body = await readBody(req);
      const record = db.records.find((item) => item.id === recordId);
      if (!record) return sendJson(res, 404, { error: "Record not found." });
      if (body.title !== undefined) record.title = String(body.title).trim();
      if (body.term !== undefined && ["Term 1", "Term 2", "Term 3"].includes(body.term)) record.term = body.term;
      if (body.type !== undefined && recordTypes.includes(body.type)) record.type = body.type;
      if (body.score !== undefined) record.score = Number(body.score);
      if (body.maxScore !== undefined) record.maxScore = Number(body.maxScore);
      if (body.status !== undefined && ["Pending", "Approved"].includes(body.status)) record.status = body.status;
      if (body.note !== undefined) record.note = String(body.note).trim();
      if (Array.isArray(body.photos)) record.photos = body.photos.filter((photo) => String(photo).startsWith("data:image/")).slice(0, 6);
      record.updatedAt = new Date().toISOString();
      writeDb(db);
      return sendJson(res, 200, { record });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/records/")) {
      const recordId = url.pathname.split("/").pop();
      db.records = db.records.filter((record) => record.id !== recordId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/students/")) {
      const studentId = url.pathname.split("/").pop();
      db.students = db.students.filter((student) => student.id !== studentId);
      db.subjects.forEach((subject) => {
        subject.studentIds = subject.studentIds.filter((idValue) => idValue !== studentId);
      });
      db.records = db.records.filter((record) => record.studentId !== studentId);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/forgot") {
      const body = await readBody(req);
      const student = db.students.find(
        (item) =>
          item.email.toLowerCase() === String(body.email || "").toLowerCase() ||
          item.username.toLowerCase() === String(body.username || "").toLowerCase(),
      );
      if (!student) return sendJson(res, 404, { error: "Student account not found." });
      const subject = encodeURIComponent("Student Record Tracker account recovery");
      const bodyText = encodeURIComponent(
        `Hello ${student.firstName},\n\nHere are your Student Record Tracker login details:\nUsername: ${student.username}\nPassword: ${student.password}\n\nPlease keep this information private.`,
      );
      return sendJson(res, 200, {
        student: publicStudent(student),
        recovery: { username: student.username, password: student.password },
        mailto: `mailto:${encodeURIComponent(student.email)}?subject=${subject}&body=${bodyText}`,
      });
    }

    return sendJson(res, 404, { error: "Route not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Something went wrong." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

ensureDb();
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return api(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Student Record Tracker running at http://localhost:${PORT}`);
});

module.exports = { server };
