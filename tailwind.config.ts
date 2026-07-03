import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#1e3a8a",
          dark: "#172554",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
