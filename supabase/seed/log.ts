// Seed/reset console output. Prints counts and IDs only — never patient details (Hard Rule 4).
export const seedLog = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};
