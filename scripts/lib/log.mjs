// The only console wrapper for Node scripts. Never pass patient data here:
// names, birthdates, medications, symptoms or notes (Hard Rule 4).
export const log = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
