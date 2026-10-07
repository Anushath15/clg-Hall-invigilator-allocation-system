import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
// Bundled Inter font (the app must work fully offline, so no Google Fonts link).
import "@fontsource/inter/latin-300.css"
import "@fontsource/inter/latin-400.css"
import "@fontsource/inter/latin-500.css"
import "@fontsource/inter/latin-600.css"
import "@fontsource/inter/latin-700.css"
import "@fontsource/inter/latin-800.css"
import "./index.css"
import { keepKeyboardFocusAfterNativeDialogs } from "./lib/native-dialogs"

keepKeyboardFocusAfterNativeDialogs()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
