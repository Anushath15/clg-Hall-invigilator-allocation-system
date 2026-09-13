/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/renderer/src/**/*.{js,ts,jsx,tsx}", "./src/renderer/index.html"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "sans-serif"] },
      colors: {
        brand: {
          primary: "#16A34A",
          dark:    "#15803D",
          light:   "#DCFCE7",
          verylight: "#F0FDF4",
          sidebar: "#123B2A",
          textmain: "#1F2937",
          textsec:  "#6B7280",
          border:   "#E5E7EB",
          warning:  "#F59E0B",
          error:    "#EF4444"
        }
      },
      boxShadow: { card: "0 1px 3px 0 rgba(0,0,0,0.05),0 1px 2px 0 rgba(0,0,0,0.03)" }
    }
  },
  plugins: []
}
