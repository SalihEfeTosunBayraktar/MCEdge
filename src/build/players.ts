/** Player names of client runs (KUYRUK 190); no Node imports, so the app's renderer uses them too. */

/** Player name of a client started without one; further clients get Dev2, Dev3... */
export const DEFAULT_PLAYER = "Dev";

/** Minecraft player names: 3 to 16 letters, digits or underscores. */
export const isPlayerName = (name: string) => /^[A-Za-z0-9_]{3,16}$/.test(name);

/** First free name of Dev, Dev2, Dev3... among the names of the clients already running. */
export function nextPlayer(taken: string[]): string {
  const name = (n: number) => (n === 1 ? DEFAULT_PLAYER : `${DEFAULT_PLAYER}${n}`);
  let n = 1;
  while (taken.includes(name(n))) n++;
  return name(n);
}

/** Log file of a client run under build/: mcedge-run.log for Dev, as before, mcedge-run-<player>.log for the others. */
export const clientLogName = (player: string) => (player === DEFAULT_PLAYER ? "mcedge-run.log" : `mcedge-run-${player}.log`);
