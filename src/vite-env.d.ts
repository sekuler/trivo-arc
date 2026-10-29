/// <reference types="vite/client" />

// Allow importing Sauce program files as raw strings in the browser
declare module '*.sauce.ts?raw' {
  const src: string
  export default src
}
