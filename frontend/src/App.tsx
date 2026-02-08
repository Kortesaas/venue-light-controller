import { useState } from "react";
import AdminPanel from "./pages/AdminPanel";
import OperatorDashboard from "./pages/OperatorDashboard";

type Mode = "operator" | "admin";

function App() {
  const [mode, setMode] = useState<Mode>("operator");

  const isAdmin = mode === "admin";

  return (
    <div className="relative">
      {isAdmin ? <AdminPanel /> : <OperatorDashboard />}
      <button
        className="fixed bottom-4 right-4 rounded-full bg-slate-800/90 px-5 py-3 text-sm font-semibold text-slate-100 shadow-lg backdrop-blur transition hover:bg-slate-700"
        onClick={() => setMode(isAdmin ? "operator" : "admin")}
      >
        {isAdmin ? "Back" : "Admin"}
      </button>
    </div>
  );
}

export default App;
