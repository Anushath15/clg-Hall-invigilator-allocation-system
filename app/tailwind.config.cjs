/** @type {import("tailwindcss").Config} */
module.exports = {
  content: ["./src/renderer/src/**/*.{js,ts,jsx,tsx}", "./src/renderer/index.html"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "sans-serif"] },
      // One step larger than Tailwind's defaults, for easier reading on screen and in the exam hall.
      fontSize: {
        xs:   ["0.8125rem", { lineHeight: "1.125rem" }],
        sm:   ["0.9375rem", { lineHeight: "1.375rem" }],
        base: ["1.0625rem", { lineHeight: "1.625rem" }],
        lg:   ["1.1875rem", { lineHeight: "1.75rem" }],
        xl:   ["1.3125rem", { lineHeight: "1.875rem" }],
        "2xl": ["1.5625rem", { lineHeight: "2rem" }],
        "3xl": ["1.9375rem", { lineHeight: "2.25rem" }]
      },
      colors: {
        brand: {
          primary: "#16A34A",
          dark:    "#15803D",
          light:   "#DCFCE7",
          verylight: "#F0FDF4",
          sidebar: "#123B2A",
          textmain: "#0B1220",
          textsec:  "#374151",
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
