// The visitor's colour theme: the system setting until they pick one with the toggle, then their pick,
// remembered across pages and reloads. The page frame reads the pick, the toggle writes it.

/** The localStorage key holding "light" or "dark", the theme the visitor picked. Absent until they pick one. */
export const themeStorageKey = "vago-theme";
