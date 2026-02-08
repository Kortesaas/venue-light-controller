import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#070b14",
      paper: alpha("#0d1524", 0.16),
    },
    primary: {
      main: "#00bcd4", // z. B. cyan
    },
    secondary: {
      main: "#ff9800",
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: [
      "system-ui",
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "sans-serif",
    ].join(","),
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: alpha("#0d1524", 0.14),
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${alpha("#ffffff", 0.14)}`,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: alpha("#0d1524", 0.14),
          backdropFilter: "blur(8px)",
          borderColor: alpha("#ffffff", 0.14),
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: alpha("#0d1524", 0.16),
          backdropFilter: "blur(8px)",
        },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: alpha("#0d1524", 0.14),
          backdropFilter: "blur(10px)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          backgroundColor: alpha("#0d1524", 0.18),
          backdropFilter: "blur(12px)",
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha("#ffffff", 0.08),
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        contained: {
          backdropFilter: "blur(6px)",
          boxShadow: "none",
        },
        outlined: {
          backgroundColor: alpha("#ffffff", 0.06),
          backdropFilter: "blur(6px)",
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
