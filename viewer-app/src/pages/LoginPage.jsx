import { useState } from "react";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { withApiBaseUrl } from "../utils/apiBase.js";

const AUTH_LOGIN_API = withApiBaseUrl("/api/auth/login");

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

export function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function performLogin(nextUsername, nextPassword) {
    const response = await fetch(AUTH_LOGIN_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(nextUsername || "").trim(),
        password: String(nextPassword || "")
      })
    });

    await readJson(response);
    if (typeof onLoginSuccess === "function") {
      onLoginSuccess();
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await performLogin(username, password);
    } catch (loginError) {
      setError(loginError.message || "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function loginAsGuest() {
    if (submitting) {
      return;
    }

    const guestUsername = "guest";
    const guestPassword = "12345678";

    setUsername(guestUsername);
    setPassword(guestPassword);
    setSubmitting(true);
    setError("");

    try {
      await performLogin(guestUsername, guestPassword);
    } catch (loginError) {
      setError(loginError.message || "访客登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ position: "relative", minHeight: "100vh", display: "grid", placeItems: "center", px: 2, bgcolor: "background.default" }}>
      <Button
        variant="outlined"
        size="small"
        onClick={loginAsGuest}
        disabled={submitting}
        sx={{ position: "absolute", top: 16, right: 16 }}
      >
        访客
      </Button>
      <Paper elevation={0} sx={{ width: "100%", maxWidth: 420, p: 3, border: "1px solid #eadbc7", borderRadius: 3 }}>
        <Stack component="form" spacing={2} onSubmit={submitLogin}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            登录
          </Typography>

          {error ? <Alert severity="error">{error}</Alert> : null}

          <TextField
            label="用户名"
            size="small"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
          <TextField
            label="密码"
            type="password"
            size="small"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "登录中..." : "登录"}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
