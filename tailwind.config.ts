import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cbc: {
          red:   "#C8102E",
          navy:  "#002C5F",
          ink:   "#1A1A1A",
          paper: "#F7F7F5",
          rule:  "#D8D8D2",
          muted: "#767676",
        },
      },
    },
  },
  plugins: [],
};
export default config;
