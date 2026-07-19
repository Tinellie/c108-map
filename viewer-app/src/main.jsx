import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#cb4b16" },
    secondary: { main: "#b83280" },
    background: { default: "#fffaf5", paper: "#fff" }
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"BIZ UDPGothic", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif',
    h3: { fontWeight: 700 }
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
