const API = "";

function getToken() {
  return localStorage.getItem("cms_token");
}

function getUser() {
  const u = localStorage.getItem("cms_user");
  return u ? JSON.parse(u) : null;
}

function setSession(token, user) {
  localStorage.setItem("cms_token", token);
  localStorage.setItem("cms_user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("cms_token");
  localStorage.removeItem("cms_user");
}

function requireAuth() {
  const token = getToken();
  const user = getUser();
  if (!token || !user) {
    window.location.href = "/login.html";
    return null;
  }
  return user;
}

function requireAdminRole() {
  const user = requireAuth();
  if (!user) return null;
  if (!["admin", "compliance_manager"].includes(user.role)) {
    window.location.href = "/dashboard.html";
    return null;
  }
  return user;
}

function requireStroRole() {
  const user = requireAuth();
  if (!user) return null;
  if (String(user.role || "").trim().toLowerCase() !== "stro") {
    window.location.href = "/dashboard.html";
    return null;
  }
  return user;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(API + url, { ...options, headers });

  if (res.status === 401) {
    clearSession();
    window.location.href = "/login.html";
    return null;
  }
  return res;
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    clearSession();
    window.location.href = "/login.html";
  }
}

function showMessage(elementId, message, type = "error") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `message ${type}`;
  el.style.display = "block";
}

function hideMessage(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.style.display = "none";
}
