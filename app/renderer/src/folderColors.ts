/**
 * Folder colours the menu offers: Minecraft's 16 dye colours (KUYRUK 178; a folder keeps any "#rrggbb" an agent sets,
 * and the earlier eight still show).
 */
export const FOLDER_COLORS = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"] as const;
export const COLOR_VALUE: Record<(typeof FOLDER_COLORS)[number], string> = {
  white: "#f9fffe", light_gray: "#9d9d97", gray: "#474f52", black: "#1d1d21", brown: "#835432", red: "#b02e26", orange: "#f9801d", yellow: "#fed83d",
  lime: "#80c71f", green: "#5e7c16", cyan: "#169c9c", light_blue: "#3ab3da", blue: "#3c44aa", purple: "#8932b8", magenta: "#c74ebd", pink: "#f38baa",
};
